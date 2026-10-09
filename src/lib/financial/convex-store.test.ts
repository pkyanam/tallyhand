/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import {
  processFinancialEvent,
  receiveStripeEvent,
} from "../../server/financial-events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
import { createConvexFinancialStore } from "./convex-store";
import { snapshotInvoice } from "../../core/financial/snapshot";
import type { Invoice } from "../../core/entities";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const secret = "synthetic-financial-test-secret-1234567890";
const scope = {
  userId: "a",
  workspaceId: "a",
  provider: "stripe" as const,
  accountId: "acct_a",
  mode: "test" as const,
};
const workspace = { userId: "a", workspaceId: "a" };
const invoice = {
  id: "invoice",
  clientId: "client",
  invoiceNumber: "INV-1",
  issueDate: 1,
  dueDate: 2,
  status: "sent",
  lineItems: [],
  subtotal: 10,
  total: 10,
  createdAt: 1,
  updatedAt: 2,
  currency: "USD",
} as Invoice;
const prepare = {
  scope,
  invoice: snapshotInvoice(invoice),
  operationId: "operation",
  requestFingerprint: "request",
  actor: { kind: "owner" as const, id: "a" },
  now: 10,
};
beforeEach(() => vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", secret));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("invoices", { ...invoice, userId: "a" });
    await ctx.db.insert("invoices", {
      ...invoice,
      id: "second-invoice",
      userId: "a",
    });
  });
  const store = createConvexFinancialStore(
    {
      query: (path, args) =>
        t.query(makeFunctionReference<"query">(path), args),
      mutation: (path, args) =>
        t.mutation(makeFunctionReference<"mutation">(path), args),
    },
    "a",
  );
  return { t, store };
}
async function event(
  store: Awaited<ReturnType<typeof setup>>["store"],
  id = "evt",
) {
  return (
    await store.receiveProviderEvent({
      scope,
      providerEventId: id,
      type: "payment",
      payload: "{}",
      receivedAt: 11,
    })
  ).event;
}
async function paid(
  store: Awaited<ReturnType<typeof setup>>["store"],
  beforeOutcome?: () => Promise<void>,
) {
  const { attempt } = await store.prepareAttempt(prepare);
  const e = await event(store);
  await beforeOutcome?.();
  const outcome = {
    scope,
    attemptId: attempt.id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 15,
    source: { kind: "event" as const, eventId: e.id },
  };
  return { attempt, e, outcome, ...(await store.applyPaymentOutcome(outcome)) };
}
it("native races reuse one frozen intent, fence dispatch, retain event-before-response and atomically project paid", async () => {
  const { t, store } = await setup();

  const pair = await Promise.all([
    store.prepareAttempt(prepare),
    store.prepareAttempt({ ...prepare, operationId: "operation2" }),
  ]);
  expect(pair[0].attempt.id).toBe(pair[1].attempt.id);
  await expect(
    store.prepareAttempt({ ...prepare, requestFingerprint: "different" }),
  ).rejects.toThrow(/fingerprint/);
  const id = pair[0].attempt.id,
    lease = { token: "dispatch", expiresAt: 30 };
  const claims = await Promise.all([
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id,
      now: 12,
      lease,
    }),
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id,
      now: 12,
      lease: { token: "other", expiresAt: 30 },
    }),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const winning = claims.find(Boolean)!.lease!;
  const e = await event(store);
  const outcome = {
    scope,
    attemptId: id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 15,
    source: { kind: "event" as const, eventId: e.id },
  };
  const payments = await Promise.all([
    store.applyPaymentOutcome(outcome),
    store.applyPaymentOutcome(outcome),
  ]);
  expect(payments[0].payment.id).toBe(payments[1].payment.id);
  const late = await store.recordAttemptDispatch({
    scope,
    id,
    now: 16,
    lease: winning,
    result: {
      state: "pending",
      checkoutSessionId: "cs",
      checkoutUrl: "https://checkout.test",
    },
  });
  expect(late.state).toBe("confirmed");
  const timeline = await store.getInvoiceTimeline(workspace, "invoice", {
    limit: 100,
  });
  expect(timeline.payments).toHaveLength(1);
  expect(timeline.allocations).toHaveLength(1);
  expect(timeline.audit.items.map((x) => x.kind)).toEqual([
    "attempt.prepared",
    "attempt.dispatch.claimed",
    "payment.confirmed",
  ]);
  const row = await t.run((ctx) => ctx.db.query("invoices").first());
  expect(row?.status).toBe("paid");
  expect(
    timeline.audit.items.find((a) => a.kind === "payment.confirmed")?.detail
      .projectionMatched,
  ).toBe(true);
  const records = await t.run((ctx) =>
    ctx.db.query("financialRecords").collect(),
  );
  expect(records.filter((r) => r.kind === "outbox")).toHaveLength(3);
});
it("requires owner and server access, scoped durable events, amount validation; invalid outcome has zero side effects", async () => {
  const { t, store } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  await expect(
    t
      .withIdentity({ subject: "a" })
      .mutation(makeFunctionReference<"mutation">("financial:prepareAttempt"), {
        userId: "a",
        input: prepare,
        serverSecret: "wrong",
      }),
  ).rejects.toThrow();
  await expect(
    t
      .withIdentity({ subject: "b" })
      .query(makeFunctionReference<"query">("financial:getAttempt"), {
        userId: "a",
        scope,
        id: attempt.id,
      }),
  ).rejects.toThrow();
  await expect(
    t.mutation(makeFunctionReference<"mutation">("financial:prepareAttempt"), {
      userId: "b",
      input: prepare,
      serverSecret: secret,
    }),
  ).rejects.toThrow(/owner/);
  const e = await event(store);
  await expect(
    store.applyPaymentOutcome({
      scope,
      attemptId: attempt.id,
      providerPaymentId: "pi",
      money: { currency: "USD", minorUnits: 999 },
      confirmedAt: 15,
      source: { kind: "event", eventId: e.id },
    }),
  ).rejects.toThrow(/amount/);
  await expect(
    store.applyPaymentOutcome({
      scope,
      attemptId: attempt.id,
      providerPaymentId: "pi",
      money: prepare.invoice.money,
      confirmedAt: 15,
      source: { kind: "event", eventId: "missing" },
    }),
  ).rejects.toThrow(/Durable/);
  expect(
    (await store.listPayments(workspace, { limit: 10 })).items,
  ).toHaveLength(0);
  expect((await store.getAttempt(scope, attempt.id))?.state).toBe("prepared");
  const received = await Promise.all([
    event(store, "same"),
    event(store, "same"),
  ]);
  expect(received[0].id).toBe(received[1].id);
});
it("does not mark a changed invoice paid; pending refunds never reduce confirmed balance, confirmations cannot regress or exceed payment", async () => {
  const { t, store } = await setup();
  const p = await paid(store, async () => {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("invoices")
        .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
        .unique();
      await ctx.db.patch(row!._id, { total: 11 });
    });
  });
  expect((await t.run((ctx) => ctx.db.query("invoices").first()))?.status).toBe(
    "sent",
  );
  const refund = {
    scope,
    providerPaymentId: "pi",
    providerRefundId: "re",
    money: { currency: "USD" as const, minorUnits: 600 },
    observedAt: 20,
    source: { kind: "event" as const, eventId: p.e.id },
  };
  await expect(
    store.applyRefundOutcome({
      ...refund,
      providerPaymentId: "not-yet",
      state: "confirmed",
    }),
  ).rejects.toThrow(/retry/);
  expect(
    (await store.applyRefundOutcome({ ...refund, state: "pending" })).refund
      .state,
  ).toBe("pending");
  expect(
    (
      await store.applyRefundOutcome({
        ...refund,
        state: "confirmed",
        observedAt: 21,
      })
    ).refund.state,
  ).toBe("confirmed");
  expect(
    (
      await store.applyRefundOutcome({
        ...refund,
        state: "failed",
        observedAt: 19,
      })
    ).refund.state,
  ).toBe("confirmed");
  await expect(
    store.applyRefundOutcome({
      ...refund,
      providerRefundId: "re2",
      state: "confirmed",
      money: { currency: "USD", minorUnits: 500 },
    }),
  ).rejects.toThrow(/exceed/);
  const timeline = await store.getInvoiceTimeline(workspace, "invoice", {
    limit: 100,
  });
  expect(
    timeline.audit.items.find((a) => a.kind === "payment.confirmed")?.detail
      .projectionMatched,
  ).toBe(false);
  expect(timeline.refunds).toHaveLength(1);
  expect(
    timeline.audit.items.filter((a) => a.kind.startsWith("refund.")),
  ).toHaveLength(2);
});
it("recovers expired event and outbox leases, never redispatches expired attempt, supports native pagination", async () => {
  const { store } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  const id = attempt.id;
  await store.claimAttemptDispatch({
    dispatchActor: { kind: "owner", id: "a" },
    scope,
    id,
    now: 11,
    lease: { token: "old", expiresAt: 20 },
  });
  expect(
    await store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id,
      now: 21,
      lease: { token: "new", expiresAt: 30 },
    }),
  ).toBeNull();
  await expect(
    store.recordAttemptDispatch({
      scope,
      id,
      now: 21,
      lease: { token: "old", expiresAt: 30 },
      result: { state: "unknown", failure: "timeout" },
    }),
  ).rejects.toThrow(/Stale/);
  const resumable = await store.listResumableWork(scope, 21, { limit: 100 });
  expect(resumable.items.map((x) => x.id)).toContain(id);
  const e = await event(store);
  await store.claimProviderEvent({
    scope,
    id: e.id,
    now: 12,
    lease: { token: "old", expiresAt: 20 },
  });
  expect(
    (
      await store.claimProviderEvent({
        scope,
        id: e.id,
        now: 21,
        lease: { token: "new", expiresAt: 30 },
      })
    )?.lease?.token,
  ).toBe("new");
  await expect(
    store.finishProviderEvent({
      scope,
      id: e.id,
      now: 22,
      lease: { token: "old", expiresAt: 30 },
      state: "processed",
    }),
  ).rejects.toThrow(/Stale/);
  const o = await store.claimOutbox(workspace, 12, {
    token: "old",
    expiresAt: 20,
  });
  expect(o).not.toBeNull();
  const parallel = await store.claimOutbox(workspace, 13, {
    token: "parallel",
    expiresAt: 20,
  });
  expect(parallel?.id).not.toBe(o?.id);
  if (parallel)
    await store.finishOutbox(workspace, parallel.id, "parallel", {
      delivered: true,
      now: 14,
    });
  const recovered = await store.claimOutbox(workspace, 21, {
    token: "new",
    expiresAt: 30,
  });
  expect(recovered?.id).toBe(o?.id);
  await expect(
    store.finishOutbox(workspace, o!.id, "old", { delivered: true, now: 22 }),
  ).rejects.toThrow(/Stale/);
  await store.finishOutbox(workspace, o!.id, "new", {
    delivered: true,
    now: 22,
  });
  expect(
    await store.claimOutbox(workspace, 23, { token: "done", expiresAt: 30 }),
  ).toBeNull();
  const first = await store.getInvoiceTimeline(workspace, "invoice", {
    limit: 1,
  });
  expect(first.audit.items).toHaveLength(1);
});
it("rechecks grant and API token revocation in the dispatch transaction", async () => {
  const { t, store } = await setup();
  const principal = { kind: "api-token" as const, tokenId: "token" };
  const grant = {
    id: "grant",
    userId: "a",
    workspaceId: "a",
    principal,
    actions: ["collect"],
    accountId: "acct_a",
    mode: "test",
    currency: "USD",
    maxMinorUnits: 1000,
    createdAt: 1,
    revokedAt: null,
  };
  await t.run(async (ctx) => {
    await ctx.db.insert("financialGrants", {
      id: "grant",
      userId: "a",
      workspaceId: "a",
      data: grant,
      revokedAt: null,
    });
    await ctx.db.insert("apiTokens", {
      id: "token",
      userId: "a",
      name: "synthetic",
      tokenHash: "fixture",
      prefix: "fixture",
      createdAt: 1,
    });
  });
  const proof = {
    grantId: "grant",
    principal,
    action: "collect" as const,
    scope,
    money: prepare.invoice.money,
    invoiceId: "invoice",
    grantedAt: 1,
  };
  const input = {
    ...prepare,
    actor: { kind: "agent" as const, id: "token" },
    authorityProof: proof,
  };
  await expect(
    store.prepareAttempt({ ...input, authorityProof: undefined }),
  ).rejects.toThrow(/authority/);
  const { attempt } = await store.prepareAttempt(input);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("financialGrants").first();
    await ctx.db.patch(row!._id, { revokedAt: 12 });
  });
  await expect(
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id: attempt.id,
      now: 13,
      lease: { token: "dispatch", expiresAt: 30 },
      authorityProof: proof,
    }),
  ).rejects.toThrow(/denied/);
  expect((await store.getAttempt(scope, attempt.id))?.state).toBe("prepared");
  await t.run(async (ctx) => {
    const row = await ctx.db.query("financialGrants").first();
    await ctx.db.patch(row!._id, { revokedAt: null });
    const token = await ctx.db.query("apiTokens").first();
    await ctx.db.delete(token!._id);
  });
  await expect(
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id: attempt.id,
      now: 14,
      lease: { token: "dispatch", expiresAt: 30 },
      authorityProof: proof,
    }),
  ).rejects.toThrow(/token revoked/);
});
it("reconciles verified remote session after lease expiry without allowing conflicting object identity", async () => {
  const { store } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  const id = attempt.id;
  await store.claimAttemptDispatch({
    dispatchActor: { kind: "owner", id: "a" },
    scope,
    id,
    now: 11,
    lease: { token: "lost", expiresAt: 20 },
  });
  const result = {
    state: "pending" as const,
    checkoutSessionId: "cs_verified",
    checkoutUrl: "https://checkout.test/verified",
    providerPaymentId: "pi_verified",
  };
  await expect(
    store.reconcileAttempt({ scope, id, now: 12, result }),
  ).rejects.toThrow(/lease active/);
  expect(
    (await store.reconcileAttempt({ scope, id, now: 21, result })).checkoutUrl,
  ).toBe(result.checkoutUrl);
  await expect(
    store.reconcileAttempt({
      scope,
      id,
      now: 22,
      result: { ...result, checkoutSessionId: "cs_other" },
    }),
  ).rejects.toThrow(/identity conflict/);
  expect(
    await store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id,
      now: 23,
      lease: { token: "never", expiresAt: 30 },
    }),
  ).toBeNull();
});
it("isolates provider event/payment identities by account and mode and rejects cross-scope sources", async () => {
  const { store } = await setup();
  const first = await paid(store);
  const otherScope = { ...scope, mode: "live" as const };
  const next = await store.prepareAttempt({
    ...prepare,
    scope: otherScope,
    invoice: snapshotInvoice({ ...invoice, id: "second-invoice" }),
  });
  await expect(
    store.applyPaymentOutcome({
      scope: otherScope,
      attemptId: next.attempt.id,
      providerPaymentId: "pi",
      money: prepare.invoice.money,
      confirmedAt: 16,
      source: { kind: "event", eventId: first.e.id },
    }),
  ).rejects.toThrow(/scope mismatch/);
  const receipt = await store.receiveProviderEvent({
    scope: otherScope,
    providerEventId: "evt",
    type: "payment",
    payload: "{}",
    receivedAt: 16,
  });
  expect(receipt.event.id).not.toBe(first.e.id);
  const second = await store.applyPaymentOutcome({
    scope: otherScope,
    attemptId: next.attempt.id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 17,
    source: { kind: "event", eventId: receipt.event.id },
  });
  expect(second.payment.id).not.toBe(first.payment.id);
  expect(
    (await store.listPayments(scope, { limit: 100 })).items.map((p) => p.id),
  ).toEqual([first.payment.id]);
  expect(
    (await store.listPayments(otherScope, { limit: 100 })).items.map(
      (p) => p.id,
    ),
  ).toEqual([second.payment.id]);
  expect(
    (
      await store.listPayments(
        { ...scope, accountId: "acct_other" },
        { limit: 100 },
      )
    ).items,
  ).toHaveLength(0);
  expect(
    (await store.listPayments(workspace, { limit: 1 })).nextCursor,
  ).toBeDefined();
  const page1 = await store.listPayments(workspace, { limit: 1 });
  const page2 = await store.listPayments(workspace, {
    limit: 1,
    cursor: page1.nextCursor,
  });
  expect(page2.items[0].id).not.toBe(page1.items[0].id);
});
it("checks live customer capability and invoice sharing inside prepare and dispatch", async () => {
  const { t, store } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("shareLinks", {
      id: "link",
      userId: "a",
      type: "invoice",
      target: { invoiceId: "invoice" },
      expiresAt: 100,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const capabilityProof = {
    kind: "customer" as const,
    linkId: "link",
    userId: "a",
    workspaceId: "a",
    invoiceId: "invoice",
    expiresAt: 100,
  };
  const input = {
    ...prepare,
    actor: { kind: "customer" as const, id: "link" },
    capabilityProof,
  };
  await expect(
    store.prepareAttempt({ ...input, capabilityProof: undefined }),
  ).rejects.toThrow(/capability/);
  const { attempt } = await store.prepareAttempt(input);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("shareLinks").first();
    await ctx.db.patch(row!._id, { revokedAt: 12 });
  });
  await expect(
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id: attempt.id,
      now: 13,
      lease: { token: "dispatch", expiresAt: 30 },
      capabilityProof,
    }),
  ).rejects.toThrow(/capability denied/);
  await t.run(async (ctx) => {
    const link = await ctx.db.query("shareLinks").first();
    await ctx.db.patch(link!._id, { revokedAt: undefined });
    const row = await ctx.db.query("invoices").first();
    await ctx.db.patch(row!._id, { cloudLinkEnabled: false });
  });
  await expect(
    store.claimAttemptDispatch({
      dispatchActor: { kind: "owner", id: "a" },
      scope,
      id: attempt.id,
      now: 14,
      lease: { token: "dispatch", expiresAt: 30 },
      capabilityProof,
    }),
  ).rejects.toThrow(/sharing disabled|snapshot mismatch/);
  expect((await store.getAttempt(scope, attempt.id))?.state).toBe("prepared");
});
it("serializes invoice collection across account/mode switches and retains confirmed intent", async () => {
  const { store, t } = await setup();
  const changed = { ...scope, accountId: "acct_other", mode: "live" as const };
  const racers = await Promise.allSettled([
    store.prepareAttempt(prepare),
    store.prepareAttempt({
      ...prepare,
      scope: changed,
      operationId: "different-account",
    }),
  ]);
  expect(racers.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(racers.filter((r) => r.status === "rejected")).toHaveLength(1);
  const winningScope = racers[0].status === "fulfilled" ? scope : changed;
  const attempt = (
    racers.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof store.prepareAttempt>>
    >
  ).value.attempt;
  const e = (
    await store.receiveProviderEvent({
      scope: winningScope,
      providerEventId: "confirm",
      type: "payment",
      payload: "{}",
      receivedAt: 11,
    })
  ).event;
  await store.applyPaymentOutcome({
    scope: winningScope,
    attemptId: attempt.id,
    providerPaymentId: "pi",
    money: prepare.invoice.money,
    confirmedAt: 12,
    source: { kind: "event", eventId: e.id },
  });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
      .unique();
    await ctx.db.patch(row!._id, { status: "sent", updatedAt: 2 });
  });
  const again = await store.prepareAttempt({
    ...prepare,
    scope: winningScope,
    operationId: "after-confirm",
  });
  expect(again.attempt.id).toBe(attempt.id);
  expect(again.attempt.state).toBe("confirmed");
  await expect(
    store.prepareAttempt({
      ...prepare,
      scope: winningScope === scope ? changed : scope,
      operationId: "switched-again",
    }),
  ).rejects.toThrow(/scope mismatch/);
  await expect(
    store.prepareAttempt({
      ...prepare,
      scope: winningScope,
      operationId: "changed-revision",
      invoice: { ...prepare.invoice, revision: "new" },
    }),
  ).rejects.toThrow(/snapshot mismatch|revision conflict/);
});
it("processes the actual Stripe event pipeline using internal durable receipt identity", async () => {
  const { store, t } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  const receipt = await receiveStripeEvent(store, scope, {
    id: "evt_provider_distinct",
    type: "checkout.session.completed",
    account: scope.accountId,
    livemode: false,
    data: {
      object: {
        id: "cs",
        livemode: false,
        payment_status: "paid",
        payment_intent: "pi",
        amount_total: 1000,
        currency: "usd",
        metadata: {
          attemptId: attempt.id,
          invoiceId: "invoice",
          accountId: scope.accountId,
          invoiceFingerprint: createHash("sha256")
            .update(attempt.invoice.fingerprint)
            .digest("hex"),
        },
      },
    },
  });
  expect(receipt.event.id).not.toBe(receipt.event.providerEventId);
  await processFinancialEvent(store, receipt.event);
  expect(
    (await store.listPayments(workspace, { limit: 10 })).items,
  ).toHaveLength(1);
  const event = await t.run((ctx) =>
    ctx.db
      .query("financialRecords")
      .withIndex("by_unique", (q) =>
        q.eq(
          "uniqueKey",
          JSON.stringify(["a", "a", "event", receipt.event.id]),
        ),
      )
      .unique(),
  );
  expect(event?.state).toBe("processed");
});
it("atomically rejects stale or cancelled invoices for owners, agents and customers at prepare and dispatch", async () => {
  for (const actorKind of ["owner", "agent", "customer"] as const) {
    const { t, store } = await setup();
    const principal = { kind: "api-token" as const, tokenId: "token" };
    const grant = {
      id: "grant",
      userId: "a",
      workspaceId: "a",
      principal,
      actions: ["collect"],
      accountId: "acct_a",
      mode: "test",
      currency: "USD",
      maxMinorUnits: 1000,
      createdAt: 1,
      revokedAt: null,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("financialGrants", {
        id: "grant",
        userId: "a",
        workspaceId: "a",
        data: grant,
        revokedAt: null,
      });
      await ctx.db.insert("apiTokens", {
        id: "token",
        userId: "a",
        name: "synthetic",
        tokenHash: "fixture",
        prefix: "fixture",
        createdAt: 1,
      });
      await ctx.db.insert("shareLinks", {
        id: "link",
        userId: "a",
        type: "invoice",
        target: { invoiceId: "invoice" },
        expiresAt: 100,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const authorityProof =
      actorKind === "agent"
        ? {
            grantId: "grant",
            principal,
            action: "collect" as const,
            scope,
            money: prepare.invoice.money,
            invoiceId: "invoice",
            grantedAt: 1,
          }
        : undefined;
    const capabilityProof =
      actorKind === "customer"
        ? {
            kind: "customer" as const,
            linkId: "link",
            userId: "a",
            workspaceId: "a",
            invoiceId: "invoice",
            expiresAt: 100,
          }
        : undefined;
    const input = {
      ...prepare,
      actor: {
        kind: actorKind,
        id:
          actorKind === "agent"
            ? "token"
            : actorKind === "customer"
              ? "link"
              : "a",
      },
      authorityProof,
      capabilityProof,
    };
    const { attempt } = await store.prepareAttempt(input);
    const edit = async (patch: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const row = await ctx.db
          .query("invoices")
          .withIndex("by_user_id", (q) =>
            q.eq("userId", "a").eq("id", "invoice"),
          )
          .unique();
        await ctx.db.patch(row!._id, patch);
      });
    await edit({ total: 11 });
    await expect(
      store.prepareAttempt({ ...input, operationId: "stale" }),
    ).rejects.toThrow(/snapshot mismatch/);
    await expect(
      store.claimAttemptDispatch({
        dispatchActor: { kind: "owner", id: "a" },
        scope,
        id: attempt.id,
        now: 12,
        lease: { token: "dispatch", expiresAt: 30 },
        authorityProof,
        capabilityProof,
      }),
    ).rejects.toThrow(/snapshot mismatch/);
    await edit({ total: 10, status: "cancelled" });
    await expect(
      store.prepareAttempt({ ...input, operationId: "cancelled" }),
    ).rejects.toThrow(/sent invoices/);
    await expect(
      store.claimAttemptDispatch({
        dispatchActor: { kind: "owner", id: "a" },
        scope,
        id: attempt.id,
        now: 13,
        lease: { token: "dispatch", expiresAt: 30 },
        authorityProof,
        capabilityProof,
      }),
    ).rejects.toThrow(/sent invoices/);
    expect((await store.getAttempt(scope, attempt.id))?.state).toBe("prepared");
  }
});
it("native concurrent invoice edit and prepare cannot dispatch against an obsolete frozen snapshot", async () => {
  const { t, store } = await setup();
  const results = await Promise.allSettled([
    store.prepareAttempt(prepare),
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("invoices")
        .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
        .unique();
      await ctx.db.patch(row!._id, { total: 11, updatedAt: 20 });
    }),
  ]);
  const first = results[0];
  if (first.status === "fulfilled")
    await expect(
      store.claimAttemptDispatch({
        dispatchActor: { kind: "owner", id: "a" },
        scope,
        id: first.value.attempt.id,
        now: 21,
        lease: { token: "dispatch", expiresAt: 30 },
      }),
    ).rejects.toThrow(/snapshot mismatch/);
  else expect(String(first.reason)).toMatch(/snapshot mismatch/);
  expect(
    (await store.listPayments(workspace, { limit: 10 })).items,
  ).toHaveLength(0);
});
it("supersedes only a stale prepared intent under the current invoice transaction and preserves operation conflicts", async () => {
  const { store, t } = await setup();
  const first = await store.prepareAttempt(prepare);
  const revised = { ...invoice, total: 11, subtotal: 11, updatedAt: 20 };
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
      .unique();
    await ctx.db.patch(row!._id, { total: 11, subtotal: 11, updatedAt: 20 });
  });
  const next = {
    ...prepare,
    operationId: "revised-op",
    requestFingerprint: "revised-request",
    invoice: snapshotInvoice(revised),
    now: 21,
  };
  await expect(
    store.prepareAttempt({ ...next, operationId: prepare.operationId }),
  ).rejects.toThrow(/fingerprint conflict/);
  const second = await store.prepareAttempt(next);
  expect(second.attempt.id).not.toBe(first.attempt.id);
  expect((await store.getAttempt(scope, first.attempt.id))?.state).toBe(
    "failed",
  );
  const timeline = await store.getInvoiceTimeline(workspace, "invoice", {
    limit: 100,
  });
  expect(
    timeline.audit.items.find((a) => a.kind === "attempt.superseded")?.detail
      .attemptId,
  ).toBe(first.attempt.id);
  await store.claimAttemptDispatch({
    dispatchActor: { kind: "owner", id: "a" },
    scope,
    id: second.attempt.id,
    now: 22,
    lease: { token: "dispatch", expiresAt: 30 },
  });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
      .unique();
    await ctx.db.patch(row!._id, { total: 12, subtotal: 12, updatedAt: 23 });
  });
  await expect(
    store.prepareAttempt({
      ...next,
      operationId: "third",
      invoice: snapshotInvoice({
        ...revised,
        total: 12,
        subtotal: 12,
        updatedAt: 23,
      }),
    }),
  ).rejects.toThrow(/revision conflict/);
});
it("verified expired unpaid checkout becomes failed without reopening dispatch or regressing confirmed money", async () => {
  const { store } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  await store.claimAttemptDispatch({
    dispatchActor: { kind: "owner", id: "a" },
    scope,
    id: attempt.id,
    now: 11,
    lease: { token: "dispatch", expiresAt: 20 },
  });
  const result = {
    state: "failed" as const,
    failure: "Verified session expired unpaid",
    checkoutSessionId: "cs_expired",
  };
  await expect(
    store.reconcileAttempt({ scope, id: attempt.id, now: 12, result }),
  ).rejects.toThrow(/lease active/);
  expect(
    (await store.reconcileAttempt({ scope, id: attempt.id, now: 21, result }))
      .state,
  ).toBe("failed");
  expect(
    (await store.reconcileAttempt({ scope, id: attempt.id, now: 22, result }))
      .state,
  ).toBe("failed");
  await expect(
    store.reconcileAttempt({
      scope,
      id: attempt.id,
      now: 23,
      result: { ...result, checkoutSessionId: "different" },
    }),
  ).rejects.toThrow(/identity conflict/);
  const next = await store.prepareAttempt({
    ...prepare,
    operationId: "new-after-expiry",
  });
  expect(next.attempt.id).not.toBe(attempt.id);
});
it("authorizes the actual dispatcher of an owner-prepared attempt and records its attribution", async () => {
  const { t, store } = await setup();
  const { attempt } = await store.prepareAttempt(prepare);
  const dispatchActor = { kind: "agent" as const, id: "token" };
  await expect(
    store.claimAttemptDispatch({
      scope,
      id: attempt.id,
      now: 11,
      lease: { token: "dispatch", expiresAt: 30 },
      dispatchActor,
    }),
  ).rejects.toThrow(/authority/);
  await expect(
    store.claimAttemptDispatch({
      scope,
      id: attempt.id,
      now: 11,
      lease: { token: "dispatch", expiresAt: 30 },
      dispatchActor: { kind: "customer", id: "link" },
    }),
  ).rejects.toThrow(/capability/);
  const principal = { kind: "api-token" as const, tokenId: "token" };
  const grant = {
    id: "grant",
    userId: "a",
    workspaceId: "a",
    principal,
    actions: ["collect"],
    accountId: "acct_a",
    mode: "test",
    currency: "USD",
    maxMinorUnits: 1000,
    createdAt: 1,
    revokedAt: null,
  };
  await t.run(async (ctx) => {
    await ctx.db.insert("financialGrants", {
      id: "grant",
      userId: "a",
      workspaceId: "a",
      data: grant,
      revokedAt: 12,
    });
    await ctx.db.insert("apiTokens", {
      id: "token",
      userId: "a",
      name: "synthetic",
      tokenHash: "fixture",
      prefix: "fixture",
      createdAt: 1,
    });
  });
  const authorityProof = {
    grantId: "grant",
    principal,
    action: "collect" as const,
    scope,
    money: prepare.invoice.money,
    invoiceId: "invoice",
    grantedAt: 1,
  };
  await expect(
    store.claimAttemptDispatch({
      scope,
      id: attempt.id,
      now: 13,
      lease: { token: "dispatch", expiresAt: 30 },
      dispatchActor,
      authorityProof,
    }),
  ).rejects.toThrow(/denied/);
  await t.run(async (ctx) => {
    const grant = await ctx.db.query("financialGrants").first();
    await ctx.db.patch(grant!._id, { revokedAt: null });
  });
  const claimed = await store.claimAttemptDispatch({
    scope,
    id: attempt.id,
    now: 14,
    lease: { token: "dispatch", expiresAt: 30 },
    dispatchActor,
    authorityProof,
  });
  expect(claimed?.actor).toEqual(prepare.actor);
  const timeline = await store.getInvoiceTimeline(workspace, "invoice", {
    limit: 100,
  });
  expect(
    timeline.audit.items.find((a) => a.kind === "attempt.dispatch.claimed")
      ?.actor,
  ).toEqual(dispatchActor);
});
it("records arbitrary-currency manual assertion atomically with status and preserves attribution on retry", async () => {
  const { t } = await setup();
  const owner = t.withIdentity({ subject: "a" });
  const mark = makeFunctionReference<"mutation">("tally:markInvoicePaid"),
    update = makeFunctionReference<"mutation">("tally:invoicesUpdate");
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
      .unique();
    await ctx.db.patch(row!._id, { currency: "JPY", total: 1000 });
  });
  await owner.mutation(mark, { userId: "a", invoiceId: "invoice" });
  const read = () =>
    t.run((ctx) =>
      ctx.db
        .query("invoices")
        .withIndex("by_user_id", (q) => q.eq("userId", "a").eq("id", "invoice"))
        .unique(),
    );
  const first = await read();
  expect(first).toMatchObject({
    status: "paid",
    manualPaymentAssertion: {
      source: "manual",
      actorId: "a",
      total: 1000,
      currency: "JPY",
    },
  });
  await owner.mutation(mark, { userId: "a", invoiceId: "invoice" });
  expect((await read())?.manualPaymentAssertion).toEqual(
    first?.manualPaymentAssertion,
  );
  await owner.mutation(update, {
    userId: "a",
    id: "invoice",
    patch: {
      manualPaymentAssertion: {
        source: "manual",
        recordedAt: 0,
        actorId: "forged",
        total: 0,
        currency: "USD",
      },
    },
  });
  expect((await read())?.manualPaymentAssertion).toEqual(
    first?.manualPaymentAssertion,
  );
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) =>
        q.eq("userId", "a").eq("id", "second-invoice"),
      )
      .unique();
    await ctx.db.patch(row!._id, { status: "paid" });
  });
  await owner.mutation(mark, { userId: "a", invoiceId: "second-invoice" });
  const legacy = await t.run((ctx) =>
    ctx.db
      .query("invoices")
      .withIndex("by_user_id", (q) =>
        q.eq("userId", "a").eq("id", "second-invoice"),
      )
      .unique(),
  );
  expect(legacy).not.toHaveProperty("manualPaymentAssertion");
  await expect(
    t
      .withIdentity({ subject: "b" })
      .mutation(mark, { userId: "a", invoiceId: "invoice" }),
  ).rejects.toThrow();
});
it("recovery cursor remains stable when the previous page changes attempt state and retry time", async () => {
  const { store } = await setup();
  const first = await store.prepareAttempt(prepare);
  const second = await store.prepareAttempt({
    ...prepare,
    invoice: snapshotInvoice({ ...invoice, id: "second-invoice" }),
    operationId: "second",
    now: 11,
  });
  await store.claimAttemptDispatch({
    scope,
    id: first.attempt.id,
    now: 12,
    lease: { token: "dispatch", expiresAt: 20 },
    dispatchActor: { kind: "owner", id: "a" },
  });
  const page1 = await store.listResumableWork(scope, 30, { limit: 1 });
  expect(page1.items[0].id).toBe(first.attempt.id);
  expect(page1.nextCursor).toBeDefined();
  await store.reconcileAttempt({
    scope,
    id: first.attempt.id,
    now: 31,
    result: {
      state: "pending",
      checkoutSessionId: "cs",
      checkoutUrl: "https://checkout.test",
    },
  });
  const page2 = await store.listResumableWork(scope, 32, {
    limit: 1,
    cursor: page1.nextCursor,
  });
  expect(page2.items[0].id).toBe(second.attempt.id);
});
