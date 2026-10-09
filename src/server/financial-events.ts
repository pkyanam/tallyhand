import { createHash, randomUUID } from "node:crypto";
import type { FinancialStore } from "@/core/financial/store";
import type {
  FinancialScope,
  PaymentAttempt,
  ProviderEvent,
} from "@/core/financial/types";
import { assertSameMoney, money } from "@/core/financial/money";
import type { StripeSessionObject } from "@/plugins/stripe/stripe-client";

export interface StripeEvent {
  id: string;
  type: string;
  account?: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}
export function validateSessionIntent(
  attempt: PaymentAttempt,
  session: StripeSessionObject,
): string {
  if (session.livemode !== (attempt.scope.mode === "live"))
    throw new Error("Checkout mode mismatch");
  const m = session.metadata;
  if (
    m?.attemptId !== attempt.id ||
    m.invoiceId !== attempt.invoice.invoiceId ||
    m.invoiceFingerprint !==
      createHash("sha256").update(attempt.invoice.fingerprint).digest("hex") ||
    m.accountId !== attempt.scope.accountId
  )
    throw new Error("Checkout intent mismatch");
  if (attempt.checkoutSessionId && attempt.checkoutSessionId !== session.id)
    throw new Error("Checkout identity mismatch");
  assertSameMoney(
    money(session.amount_total!, session.currency!),
    attempt.invoice.money,
  );
  return session.id;
}
export function validateSession(
  attempt: PaymentAttempt,
  session: StripeSessionObject,
): string {
  validateSessionIntent(attempt, session);
  if (session.payment_status !== "paid")
    throw new Error("Checkout has no confirmed payment");
  const id =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!id) throw new Error("Checkout payment identity missing");
  return id;
}
export async function receiveStripeEvent(
  store: FinancialStore,
  scope: FinancialScope,
  event: StripeEvent,
) {
  if (
    !event.id ||
    typeof event.livemode !== "boolean" ||
    event.livemode !== (scope.mode === "live") ||
    (event.account && event.account !== scope.accountId)
  )
    throw new Error("Event scope mismatch");
  return store.receiveProviderEvent({
    scope,
    providerEventId: event.id,
    type: event.type,
    payload: JSON.stringify(event),
    receivedAt: Date.now(),
  });
}
export async function processFinancialEvent(
  store: FinancialStore,
  received: ProviderEvent,
): Promise<void> {
  const now = Date.now(),
    lease = { token: randomUUID(), expiresAt: now + 30_000 };
  const claim = { scope: received.scope, id: received.id, now, lease };
  const event = await store.claimProviderEvent(claim);
  if (!event) return;
  try {
    const parsed = JSON.parse(event.payload) as StripeEvent;
    const obj = parsed.data.object;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      const session = obj as unknown as StripeSessionObject;
      if (session.payment_status !== "paid") {
        await store.finishProviderEvent({ ...claim, state: "processed" });
        return;
      }
      const attempt = session.metadata?.attemptId
        ? await store.getAttempt(event.scope, session.metadata.attemptId)
        : null;
      if (!attempt) throw new Error("Unknown payment attempt");
      await store.applyPaymentOutcome({
        scope: event.scope,
        attemptId: attempt.id,
        providerPaymentId: validateSession(attempt, session),
        money: attempt.invoice.money,
        confirmedAt: now,
        source: { kind: "event", eventId: event.id },
      });
    } else if (event.type === "checkout.session.expired") {
      const session = obj as unknown as StripeSessionObject;
      const attempt = session.metadata?.attemptId
        ? await store.getAttempt(event.scope, session.metadata.attemptId)
        : null;
      if (!attempt) throw new Error("Unknown payment attempt");
      validateSessionIntent(attempt, session);
      if (session.status !== "expired" || session.payment_status !== "unpaid")
        throw new Error("Checkout expiration proof invalid");
      await store.reconcileAttempt({
        scope: event.scope,
        id: attempt.id,
        now,
        result: {
          state: "failed",
          failure: "Stripe checkout expired unpaid",
          checkoutSessionId: session.id,
        },
      });
    } else if (["refund.created", "refund.updated"].includes(event.type)) {
      const paymentId =
        typeof obj.payment_intent === "string"
          ? obj.payment_intent
          : (obj.payment_intent as { id?: string })?.id;
      if (!paymentId || typeof obj.id !== "string")
        throw new Error("Refund payment identity missing");
      if (
        ![
          "succeeded",
          "pending",
          "failed",
          "canceled",
          "requires_action",
        ].includes(String(obj.status))
      )
        throw new Error("Refund status unsupported");
      await store.applyRefundOutcome({
        scope: event.scope,
        providerPaymentId: paymentId,
        providerRefundId: obj.id,
        money: money(obj.amount as number, obj.currency as string),
        state:
          obj.status === "succeeded"
            ? "confirmed"
            : ["failed", "canceled"].includes(String(obj.status))
              ? "failed"
              : "pending",
        observedAt: now,
        source: { kind: "event", eventId: event.id },
      });
    }
    await store.finishProviderEvent({ ...claim, state: "processed" });
  } catch (error) {
    await store.finishProviderEvent({
      ...claim,
      state: "retry",
      retryAt: now + 30_000,
      failure:
        error instanceof Error ? error.message : "Event processing unavailable",
    });
  }
}
