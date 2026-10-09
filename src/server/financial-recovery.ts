import { money } from "@/core/financial/money";
import { randomUUID } from "node:crypto";
import type { FinancialStore } from "@/core/financial/store";
import type { FinancialScope, WorkspaceIdentity } from "@/core/financial/types";
import {
  listCheckoutSessions,
  listPaymentRefunds,
  type StripeSessionObject,
  retrieveCheckoutSession,
  StripeError,
} from "@/plugins/stripe/stripe-client";
import {
  processFinancialEvent,
  validateSession,
  validateSessionIntent,
} from "./financial-events";
import { resolveCheckoutStripeKey, getConnectAccount } from "./stripe-connect";

/** Bounded reads only: unknown creates are never blindly dispatched again. */
export async function recoverFinancialWork(
  store: FinancialStore,
  scope: FinancialScope,
  limit = 50,
  cursors: {
    deadline?: number;
    workCursor?: string;
    paymentCursor?: string;
    providerCursors?: Record<string, string>;
  } = {},
) {
  const resolved = await resolveCheckoutStripeKey(scope.userId);
  if (
    resolved.mode !== scope.mode ||
    (resolved.stripeAccount ??
      (await getConnectAccount(resolved.secretKey)).id) !== scope.accountId
  )
    throw new StripeError("Recovery account mismatch", 503);
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  let backlog = false,
    examined = 0,
    retryCount = 0;
  let workCursor = cursors.workCursor,
    paymentCursor = cursors.paymentCursor;
  const providerCursors: Record<string, string> = {
    ...cursors.providerCursors,
  };
  const workDeadline =
    cursors.deadline === undefined
      ? undefined
      : Date.now() + Math.max(0, cursors.deadline - Date.now()) / 2;
  let workPhase = true;
  const expired = () => {
    const deadline = workPhase ? workDeadline : cursors.deadline;
    return deadline !== undefined && Date.now() >= deadline;
  };
  for (let count = 0; count < boundedLimit; count++) {
    if (expired()) {
      backlog = true;
      break;
    }
    let work: Awaited<ReturnType<FinancialStore["listResumableWork"]>>;
    try {
      work = await store.listResumableWork(scope, Date.now(), {
        limit: 1,
        cursor: workCursor,
      });
    } catch {
      backlog = true;
      retryCount++;
      break;
    }
    const item = work.items[0];
    if (!item) {
      workCursor = work.nextCursor;
      if (workCursor) continue;
      break;
    }
    examined++;
    const advanceWork = () => {
      workCursor = work.nextCursor;
    };
    if ("providerEventId" in item) {
      try {
        await processFinancialEvent(store, item);
      } catch {
        backlog = true;
        retryCount++;
      }
      advanceWork();
      if (!workCursor) break;
      continue;
    }
    if (item.state === "prepared") {
      advanceWork();
      if (!workCursor) break;
      continue;
    }
    try {
      let sessions: StripeSessionObject[] = [];
      if (item.checkoutSessionId)
        sessions = [
          await retrieveCheckoutSession(
            resolved.secretKey,
            item.checkoutSessionId,
            resolved.stripeAccount ?? undefined,
          ),
        ];
      else {
        let cursor: string | undefined =
          cursors.providerCursors?.[`attempt:${item.id}`];
        for (let page = 0; page < 5; page++) {
          if (expired()) {
            if (cursor) providerCursors[`attempt:${item.id}`] = cursor;
            backlog = true;
            break;
          }
          const result = await listCheckoutSessions(
            resolved.secretKey,
            item.createdAt - 60_000,
            resolved.stripeAccount ?? undefined,
            cursor,
          );
          sessions.push(
            ...result.data.filter((s) => s.metadata?.attemptId === item.id),
          );
          if (!result.has_more) {
            delete providerCursors[`attempt:${item.id}`];
            break;
          }
          cursor = result.data.at(-1)?.id;
          if (!cursor || page === 4) {
            backlog = true;
            if (cursor) providerCursors[`attempt:${item.id}`] = cursor;
          }
        }
      }
      for (const session of sessions) {
        delete providerCursors[`attempt:${item.id}`];
        validateSessionIntent(item, session);
        if (
          session.status === "expired" &&
          session.payment_status === "unpaid"
        ) {
          await store.reconcileAttempt({
            scope,
            id: item.id,
            now: Date.now(),
            result: {
              state: "failed",
              failure: "Stripe checkout expired unpaid",
              checkoutSessionId: session.id,
            },
          });
          continue;
        }
        if (session.url)
          await store.reconcileAttempt({
            scope,
            id: item.id,
            now: Date.now(),
            result: {
              state: "pending",
              checkoutSessionId: session.id,
              checkoutUrl: session.url,
            },
          });
        if (session.payment_status !== "paid") continue;
        await store.applyPaymentOutcome({
          scope,
          attemptId: item.id,
          providerPaymentId: validateSession(item, session),
          money: item.invoice.money,
          confirmedAt: Date.now(),
          source: { kind: "reconciliation", reference: session.id },
        });
      }
    } catch {
      backlog = true;
      retryCount++;
    }
    advanceWork();
    if (!workCursor) break;
  }
  workPhase = false;
  for (let count = 0; count < boundedLimit; count++) {
    if (expired()) {
      backlog = true;
      break;
    }
    let payments: Awaited<ReturnType<FinancialStore["listPayments"]>>;
    try {
      payments = await store.listPayments(scope, {
        limit: 1,
        cursor: paymentCursor,
      });
    } catch {
      backlog = true;
      retryCount++;
      break;
    }
    const payment = payments.items[0];
    if (!payment) {
      paymentCursor = payments.nextCursor;
      if (paymentCursor) continue;
      break;
    }
    const advancePayment = () => {
      paymentCursor = payments.nextCursor;
    };
    if (
      payment.scope.accountId !== scope.accountId ||
      payment.scope.mode !== scope.mode
    ) {
      advancePayment();
      if (!paymentCursor) break;
      continue;
    }
    let cursor: string | undefined =
      cursors.providerCursors?.[`payment:${payment.providerPaymentId}`];
    try {
      for (let page = 0; page < 5; page++) {
        if (expired()) {
          if (cursor)
            providerCursors[`payment:${payment.providerPaymentId}`] = cursor;
          backlog = true;
          break;
        }
        const refunds = await listPaymentRefunds(
          resolved.secretKey,
          payment.providerPaymentId,
          resolved.stripeAccount ?? undefined,
          cursor,
        );
        for (const refund of refunds.data) {
          if (
            refund.livemode !== (scope.mode === "live") ||
            refund.payment_intent !== payment.providerPaymentId
          )
            throw new StripeError("Refund identity mismatch", 503);
          if (
            ![
              "succeeded",
              "pending",
              "failed",
              "canceled",
              "requires_action",
            ].includes(refund.status)
          )
            throw new StripeError("Refund status unsupported", 503);
          await store.applyRefundOutcome({
            scope,
            providerPaymentId: payment.providerPaymentId,
            providerRefundId: refund.id,
            money: money(refund.amount, refund.currency),
            state:
              refund.status === "succeeded"
                ? "confirmed"
                : ["failed", "canceled"].includes(refund.status)
                  ? "failed"
                  : "pending",
            observedAt: Date.now(),
            source: { kind: "reconciliation", reference: refund.id },
          });
        }
        if (!refunds.has_more) {
          delete providerCursors[`payment:${payment.providerPaymentId}`];
          break;
        }
        cursor = refunds.data.at(-1)?.id;
        if (!cursor || page === 4) {
          backlog = true;
          if (cursor)
            providerCursors[`payment:${payment.providerPaymentId}`] = cursor;
        }
      }
    } catch {
      backlog = true;
      retryCount++;
    }
    advancePayment();
    if (!paymentCursor) break;
  }
  return {
    examined,
    retryCount,
    nextCursor: workCursor,
    paymentCursor,
    backlog,
    providerCursors,
  };
}
/** At-least-once delivery; consumers receive the durable outbox identity. */
export async function deliverFinancialOutbox(
  store: FinancialStore,
  workspace: WorkspaceIdentity,
  deliver: (topic: string, payload: string, id: string) => Promise<void>,
  limit = 50,
  deadline?: number,
) {
  for (let i = 0; i < limit; i++) {
    if (deadline !== undefined && Date.now() >= deadline) break;
    const now = Date.now(),
      lease = { token: randomUUID(), expiresAt: now + 30_000 };
    const record = await store.claimOutbox(workspace, now, lease);
    if (!record) break;
    try {
      {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            deliver(record.topic, record.payload, record.id),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Outbox delivery deadline exceeded")),
                Math.max(
                  1,
                  Math.min(
                    25_000,
                    deadline === undefined ? 25_000 : deadline - Date.now(),
                  ),
                ),
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      await store.finishOutbox(workspace, record.id, lease.token, {
        delivered: true,
        now: Date.now(),
      });
    } catch {
      await store.finishOutbox(workspace, record.id, lease.token, {
        delivered: false,
        now: Date.now(),
        retryAt: now + 30_000,
        failure: "Outbox delivery unavailable",
      });
    }
  }
}
