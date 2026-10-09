/** Financial writes run entirely inside one authenticated Convex transaction. */
import { v } from "convex/values";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
  DataModelFromSchemaDefinition,
} from "convex/server";
import type schema from "./schema";
import { ownerQuery, serverMutation } from "./access";
import {
  assertFinancialScope,
  assertPaymentOutcome,
  freezeInvoiceSnapshot,
  nextRefundState,
  providerIdentityKey,
} from "../src/core/financial/invariants";
import {
  assertFinancialGrant,
  assertFinancialDispatchActor,
  assertFinancialCapability,
  type FinancialCapabilityProof,
  type FinancialGrantProof,
} from "../src/core/financial/authority";
import type { Invoice } from "../src/core/entities";
import {
  invoiceFingerprint,
  snapshotInvoice,
} from "../src/core/financial/snapshot";
import {
  assertSameMoney,
  money,
  netConfirmedMoney,
} from "../src/core/financial/money";
import type {
  ClaimInput,
  DispatchResult,
  PaymentOutcomeInput,
  PrepareAttemptInput,
  RefundOutcomeInput,
} from "../src/core/financial/store";
import type {
  FinancialScope,
  WorkspaceIdentity,
  PageQuery,
  PaymentAttempt,
  ProviderEvent,
  Payment,
  Allocation,
  Refund,
  ManualPaymentEvidence,
  Lease,
  OutboxRecord,
  FinancialActor,
} from "../src/core/financial/types";

type Model = DataModelFromSchemaDefinition<typeof schema>;
type Read = GenericQueryCtx<Model>;
type Write = GenericMutationCtx<Model>;
type Kind =
  | "attempt"
  | "operation"
  | "event"
  | "payment"
  | "allocation"
  | "refund"
  | "manual"
  | "audit"
  | "outbox";
function workspace(w: WorkspaceIdentity, userId: string) {
  if (!w || w.userId !== userId || !userId || w.workspaceId !== userId)
    throw new Error("Financial owner/workspace mismatch");
}
function scope(s: FinancialScope, userId: string) {
  workspace(s, userId);
  assertFinancialScope(s, s);
  if (s.provider !== "stripe" || !["test", "live"].includes(s.mode))
    throw new Error("Invalid provider scope");
}
function sk(s: FinancialScope) {
  return providerIdentityKey(s, "scope");
}
function uk(w: WorkspaceIdentity, kind: Kind, id: string) {
  return JSON.stringify([w.userId, w.workspaceId, kind, id]);
}
function clean<T>(a: T): T {
  return JSON.parse(JSON.stringify(a));
}
function timestamp(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid timestamp");
}
function validateLease(l: Lease, now: number) {
  timestamp(now);
  timestamp(l.expiresAt);
  if (!l.token || l.expiresAt <= now) throw new Error("Invalid lease");
}
async function find(ctx: Read, key: string) {
  return ctx.db
    .query("financialRecords")
    .withIndex("by_unique", (q) => q.eq("uniqueKey", key))
    .unique();
}
async function record(ctx: Read, w: WorkspaceIdentity, kind: Kind, id: string) {
  return find(ctx, uk(w, kind, id));
}
async function save(
  ctx: Write,
  w: WorkspaceIdentity,
  kind: Kind,
  data: any,
  invoiceId: string,
  now: number,
  key = uk(w, kind, data.id),
  scopeKey = "",
) {
  await ctx.db.insert("financialRecords", {
    userId: w.userId,
    workspaceId: w.workspaceId,
    scopeKey,
    kind,
    id: data.id,
    uniqueKey: key,
    invoiceId,
    state: data.state ?? "",
    availableAt:
      data.retryAt ?? data.availableAt ?? data.lease?.expiresAt ?? now,
    createdAt: now,
    data: clean(data),
  });
}
async function change(
  ctx: Write,
  row: NonNullable<Awaited<ReturnType<typeof find>>>,
  data: any,
  now: number,
) {
  await ctx.db.patch(row._id, {
    data: clean(data),
    state: data.state ?? "",
    availableAt:
      data.retryAt ?? data.availableAt ?? data.lease?.expiresAt ?? now,
  });
}
function fenced(data: { lease?: Lease }, input: ClaimInput) {
  validateLease(input.lease, input.now);
  if (
    data.lease?.token !== input.lease.token ||
    data.lease.expiresAt <= input.now
  )
    throw new Error("Stale financial lease");
}
async function assertCurrentInvoice(
  ctx: Read,
  s: FinancialScope,
  frozen: PaymentAttempt["invoice"],
) {
  const row = await ctx.db
    .query("invoices")
    .withIndex("by_user_id", (q) =>
      q.eq("userId", s.userId).eq("id", frozen.invoiceId),
    )
    .unique();
  if (!row) throw new Error("Invoice no longer exists");
  const { _id, _creationTime, userId, ...invoice } = row;
  const current = snapshotInvoice(invoice as Invoice);
  if (
    current.invoiceId !== frozen.invoiceId ||
    current.revision !== frozen.revision ||
    current.fingerprint !== frozen.fingerprint
  )
    throw new Error("Current invoice snapshot mismatch");
  assertSameMoney(current.money, frozen.money);
}
async function collectAuthority(
  ctx: Read,
  s: FinancialScope,
  invoice: PaymentAttempt["invoice"],
  actor: FinancialActor,
  proof?: FinancialGrantProof,
) {
  if (actor.kind !== "agent" && !proof) return;
  if (
    !proof ||
    proof.action !== "collect" ||
    proof.invoiceId !== invoice.invoiceId
  )
    throw new Error("Financial collection authority required");
  assertFinancialScope(proof.scope, s);
  assertSameMoney(proof.money!, invoice.money);
  const principalId =
    proof.principal.kind === "api-token"
      ? proof.principal.tokenId
      : proof.principal.clientId;
  if (actor.kind === "agent" && actor.id !== principalId)
    throw new Error("Financial principal mismatch");
  const row = await ctx.db
    .query("financialGrants")
    .withIndex("by_grant_id", (q) => q.eq("id", proof.grantId))
    .unique();
  assertFinancialGrant(
    row ? { ...row.data, revokedAt: row.revokedAt } : null,
    proof,
  );
  if (proof.principal.kind === "api-token") {
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_user_id", (q) =>
        q
          .eq("userId", s.userId)
          .eq(
            "id",
            proof.principal.kind === "api-token" ? proof.principal.tokenId : "",
          ),
      )
      .unique();
    if (!token) throw new Error("Financial API token revoked");
  }
}
async function collectCapability(
  ctx: Read,
  s: FinancialScope,
  invoice: PaymentAttempt["invoice"],
  actor: FinancialActor,
  now: number,
  proof?: FinancialCapabilityProof,
) {
  if (actor.kind !== "customer" && !proof) return;
  if (!proof || (actor.kind === "customer" && actor.id !== proof.linkId))
    throw new Error("Financial capability required");
  const link = await ctx.db
    .query("shareLinks")
    .withIndex("by_link_id", (q) => q.eq("id", proof.linkId))
    .unique();
  assertFinancialCapability(link, proof, s, invoice.invoiceId, now);
  const row = await ctx.db
    .query("invoices")
    .withIndex("by_user_id", (q) =>
      q.eq("userId", s.userId).eq("id", invoice.invoiceId),
    )
    .unique();
  if (!row || row.cloudLinkEnabled === false)
    throw new Error("Financial invoice sharing disabled");
}
async function audit(
  ctx: Write,
  w: WorkspaceIdentity,
  invoiceId: string,
  kind: string,
  now: number,
  detail: Record<string, string | number | boolean | null>,
  actor: FinancialActor = { kind: "system", id: "financial" },
) {
  const id = crypto.randomUUID();
  const event = {
    id,
    workspace: w,
    invoiceId,
    kind,
    actor,
    createdAt: now,
    detail,
  };
  await save(ctx, w, "audit", event, invoiceId, now);
  await save(
    ctx,
    w,
    "outbox",
    {
      id: crypto.randomUUID(),
      workspace: w,
      auditEventId: id,
      topic: kind,
      payload: JSON.stringify(event),
      state: "pending",
      attempts: 0,
      availableAt: now,
    },
    invoiceId,
    now,
  );
}
async function source(
  ctx: Read,
  input: PaymentOutcomeInput | RefundOutcomeInput,
) {
  if (input.source.kind === "event") {
    const e = await record(ctx, input.scope, "event", input.source.eventId);
    if (!e) throw new Error("Durable provider event required");
    assertFinancialScope(e.data.scope, input.scope);
  } else if (input.source.kind !== "reconciliation" || !input.source.reference)
    throw new Error("Outcome source required");
}
function pageLimit(q: PageQuery) {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)
    throw new Error("Page limit must be 1..100");
  return q.limit;
}
async function list(
  ctx: Read,
  w: WorkspaceIdentity,
  kind: Kind,
  q: PageQuery,
  invoiceId?: string,
) {
  const limit = pageLimit(q);
  const query =
    invoiceId === undefined
      ? ctx.db
          .query("financialRecords")
          .withIndex("by_owner_kind", (x) =>
            x
              .eq("userId", w.userId)
              .eq("workspaceId", w.workspaceId)
              .eq("kind", kind),
          )
      : ctx.db
          .query("financialRecords")
          .withIndex("by_invoice_kind", (x) =>
            x
              .eq("userId", w.userId)
              .eq("workspaceId", w.workspaceId)
              .eq("invoiceId", invoiceId)
              .eq("kind", kind),
          );
  const result = await query.paginate({
    cursor: q.cursor ?? null,
    numItems: limit,
    maximumRowsRead: 1000,
  });
  return clean({
    items: result.page.map((r) => r.data),
    nextCursor: result.isDone ? undefined : result.continueCursor,
  });
}

export const prepareAttempt = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const input = raw as PrepareAttemptInput;
    scope(input.scope, userId);
    timestamp(input.now);
    const invoice = freezeInvoiceSnapshot(input.invoice);
    if (
      !input.operationId ||
      !input.requestFingerprint ||
      !input.actor?.id ||
      invoice.money.minorUnits === 0
    )
      throw new Error("Invalid collection request");
    await collectAuthority(
      ctx,
      input.scope,
      invoice,
      input.actor,
      input.authorityProof,
    );
    await collectCapability(
      ctx,
      input.scope,
      invoice,
      input.actor,
      input.now,
      input.capabilityProof,
    );
    const opKey = providerIdentityKey(
      input.scope,
      `operation:${input.operationId}`,
    );
    const op = await find(ctx, opKey);
    if (op) {
      if (op.data.fingerprint !== input.requestFingerprint)
        throw new Error("Operation fingerprint conflict");
      await assertCurrentInvoice(ctx, input.scope, invoice);
      const a = await record(ctx, input.scope, "attempt", op.data.attemptId);
      if (!a) throw new Error("Missing attempt");
      return { attempt: a.data, reused: true };
    }
    await assertCurrentInvoice(ctx, input.scope, invoice);
    const active = await ctx.db
      .query("financialRecords")
      .withIndex("by_invoice_kind", (q) =>
        q
          .eq("userId", userId)
          .eq("workspaceId", input.scope.workspaceId)
          .eq("invoiceId", invoice.invoiceId)
          .eq("kind", "attempt"),
      )
      .order("desc")
      .take(201);
    if (active.length > 200)
      throw new Error("Invoice attempt history limit exceeded");
    // Collection intent belongs to the invoice, including account/mode switches.
    let prior = active.find((r) => r.state !== "failed");
    if (prior) assertFinancialScope(prior.data.scope, input.scope);
    if (
      prior &&
      (prior.data.invoice.fingerprint !== invoice.fingerprint ||
        prior.data.invoice.revision !== invoice.revision)
    ) {
      if (prior.state !== "prepared")
        throw new Error("Outstanding invoice revision conflict");
      await change(
        ctx,
        prior,
        {
          ...prior.data,
          state: "failed",
          failure: "Invoice changed before dispatch",
          updatedAt: input.now,
        },
        input.now,
      );
      await audit(
        ctx,
        input.scope,
        invoice.invoiceId,
        "attempt.superseded",
        input.now,
        { attemptId: prior.data.id, reason: "Invoice changed before dispatch" },
      );
      prior = undefined;
    }
    const attempt: PaymentAttempt = prior?.data ?? {
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      scope: input.scope,
      invoice,
      operationId: input.operationId,
      requestFingerprint: input.requestFingerprint,
      providerIdempotencyKey: crypto.randomUUID(),
      actor: input.actor,
      ...(input.capabilityProof
        ? { capabilityProof: input.capabilityProof }
        : {}),
      state: "prepared",
      createdAt: input.now,
      updatedAt: input.now,
    };
    if (!prior) {
      await save(
        ctx,
        input.scope,
        "attempt",
        attempt,
        invoice.invoiceId,
        input.now,
        undefined,
        sk(input.scope),
      );
      await audit(
        ctx,
        input.scope,
        invoice.invoiceId,
        "attempt.prepared",
        input.now,
        { attemptId: attempt.id },
        input.actor,
      );
    }
    await save(
      ctx,
      input.scope,
      "operation",
      {
        id: input.operationId,
        attemptId: attempt.id,
        fingerprint: input.requestFingerprint,
      },
      invoice.invoiceId,
      input.now,
      opKey,
      sk(input.scope),
    );
    return { attempt, reused: !!prior };
  },
});
export const claimAttemptDispatch = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const i = raw as ClaimInput;
    scope(i.scope, userId);
    validateLease(i.lease, i.now);
    const row = await record(ctx, i.scope, "attempt", i.id);
    if (!row) return null;
    assertFinancialScope(row.data.scope, i.scope);
    await assertCurrentInvoice(ctx, i.scope, row.data.invoice);
    const dispatchActor = (i as ClaimInput & { dispatchActor: FinancialActor })
      .dispatchActor;
    assertFinancialDispatchActor(
      dispatchActor,
      i.scope,
      i.authorityProof,
      i.capabilityProof,
    );
    await collectAuthority(
      ctx,
      i.scope,
      row.data.invoice,
      dispatchActor,
      i.authorityProof,
    );
    await collectCapability(
      ctx,
      i.scope,
      row.data.invoice,
      dispatchActor,
      i.now,
      i.capabilityProof,
    );
    if (row.state !== "prepared") return null;
    const next = {
      ...row.data,
      state: "dispatching",
      dispatchActor,
      lease: i.lease,
      updatedAt: i.now,
    };
    await change(ctx, row, next, i.now);
    await audit(
      ctx,
      i.scope,
      row.data.invoice.invoiceId,
      "attempt.dispatch.claimed",
      i.now,
      { attemptId: i.id },
      dispatchActor,
    );
    return next;
  },
});
export const recordAttemptDispatch = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const i = raw as ClaimInput & { result: DispatchResult };
    scope(i.scope, userId);
    const row = await record(ctx, i.scope, "attempt", i.id);
    if (!row) throw new Error("Attempt missing");
    assertFinancialScope(row.data.scope, i.scope);
    if (row.state === "confirmed") return row.data;
    fenced(row.data, i);
    if (row.state !== "dispatching") throw new Error("Attempt not dispatching");
    if (!["pending", "unknown", "failed"].includes(i.result.state))
      throw new Error("Invalid dispatch state");
    if (
      i.result.state === "pending" &&
      (!i.result.checkoutSessionId || !i.result.checkoutUrl)
    )
      throw new Error("Checkout identity required");
    const next = {
      ...row.data,
      ...i.result,
      lease: undefined,
      updatedAt: i.now,
    };
    await change(ctx, row, next, i.now);
    return clean(next);
  },
});
export const reconcileAttempt = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: i }) => {
    scope(i.scope, userId);
    timestamp(i.now);
    const row = await record(ctx, i.scope, "attempt", i.id);
    if (!row) throw new Error("Attempt missing");
    assertFinancialScope(row.data.scope, i.scope);
    if (row.state === "confirmed") return row.data;
    if (row.state === "dispatching" && row.data.lease?.expiresAt > i.now)
      throw new Error("Attempt dispatch lease active");
    if (!["unknown", "dispatching", "pending", "failed"].includes(row.state))
      throw new Error("Attempt cannot be reconciled");
    const r = i.result;
    if (
      !r.checkoutSessionId ||
      !["pending", "failed"].includes(r.state) ||
      (r.state === "pending" && !r.checkoutUrl) ||
      (r.state === "failed" && !r.failure)
    )
      throw new Error("Verified checkout identity required");
    if (
      (row.data.checkoutSessionId &&
        row.data.checkoutSessionId !== r.checkoutSessionId) ||
      (row.data.providerPaymentId &&
        r.providerPaymentId &&
        row.data.providerPaymentId !== r.providerPaymentId)
    )
      throw new Error("Provider checkout identity conflict");
    if (row.state === "failed") {
      if (
        row.data.checkoutSessionId !== r.checkoutSessionId ||
        r.state !== "failed"
      )
        throw new Error("Provider checkout identity conflict");
      return row.data;
    }
    const next = {
      ...row.data,
      ...r,
      lease: undefined,
      failure: r.state === "failed" ? r.failure : undefined,
      updatedAt: i.now,
    };
    await change(ctx, row, next, i.now);
    return clean(next);
  },
});
export const getAttempt = ownerQuery({
  args: { userId: v.string(), scope: v.any(), id: v.string() },
  handler: async (ctx, { userId, scope: s, id }) => {
    scope(s, userId);
    const row = await record(ctx, s, "attempt", id);
    if (!row) return null;
    assertFinancialScope(row.data.scope, s);
    return row.data;
  },
});
export const receiveProviderEvent = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: i }) => {
    scope(i.scope, userId);
    timestamp(i.receivedAt);
    if (!i.type || typeof i.payload !== "string")
      throw new Error("Invalid event");
    const key = providerIdentityKey(i.scope, `event:${i.providerEventId}`);
    const prior = await find(ctx, key);
    if (prior) {
      if (prior.data.payload !== i.payload || prior.data.type !== i.type)
        throw new Error("Provider event identity conflict");
      const existing = await record(ctx, i.scope, "event", prior.data.eventId);
      if (!existing) throw new Error("Missing event receipt");
      return { event: existing.data, reused: true };
    }
    const event = { ...i, id: crypto.randomUUID(), state: "received" };
    await save(
      ctx,
      i.scope,
      "event",
      event,
      "",
      i.receivedAt,
      undefined,
      sk(i.scope),
    );
    // Internal receipt ID is the source capability; provider ID remains the dedup key.
    await save(
      ctx,
      i.scope,
      "operation",
      {
        id: `event-id:${event.id}`,
        eventId: event.id,
        payload: i.payload,
        type: i.type,
      },
      "",
      i.receivedAt,
      key,
      sk(i.scope),
    );
    return { event, reused: false };
  },
});
async function eventRow(ctx: Read, s: FinancialScope, id: string) {
  return record(ctx, s, "event", id);
}
export const claimProviderEvent = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const i = raw as ClaimInput;
    scope(i.scope, userId);
    validateLease(i.lease, i.now);
    const row = await eventRow(ctx, i.scope, i.id);
    if (!row) return null;
    assertFinancialScope(row.data.scope, i.scope);
    if (
      !["received", "retry", "processing"].includes(row.state) ||
      (row.state === "processing" && row.data.lease?.expiresAt > i.now) ||
      (row.data.retryAt ?? 0) > i.now
    )
      return null;
    const next = {
      ...row.data,
      state: "processing",
      lease: i.lease,
      retryAt: undefined,
    };
    await change(ctx, row, next, i.now);
    return clean(next);
  },
});
export const finishProviderEvent = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: i }) => {
    scope(i.scope, userId);
    const row = await eventRow(ctx, i.scope, i.id);
    if (!row) throw new Error("Event missing");
    assertFinancialScope(row.data.scope, i.scope);
    fenced(row.data, i);
    if (
      row.state !== "processing" ||
      !["processed", "retry", "quarantined"].includes(i.state)
    )
      throw new Error("Invalid event completion");
    if (i.state === "retry") {
      timestamp(i.retryAt);
      if (i.retryAt < i.now) throw new Error("Invalid retry time");
    }
    await change(
      ctx,
      row,
      {
        ...row.data,
        state: i.state,
        lease: undefined,
        retryAt: i.retryAt,
        failure: i.failure,
      },
      i.now,
    );
  },
});
export const applyPaymentOutcome = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const i = raw as PaymentOutcomeInput;
    scope(i.scope, userId);
    timestamp(i.confirmedAt);
    await source(ctx, i);
    const attempt = await record(ctx, i.scope, "attempt", i.attemptId);
    if (!attempt) throw new Error("Attempt missing");
    assertPaymentOutcome(attempt.data, i);
    const key = providerIdentityKey(i.scope, `payment:${i.providerPaymentId}`);
    const prior = await find(ctx, key);
    if (prior) {
      if (prior.data.attemptId !== i.attemptId)
        throw new Error("Provider payment identity conflict");
      assertSameMoney(prior.data.money, i.money);
      const allocation = await record(
        ctx,
        i.scope,
        "allocation",
        prior.data.id,
      );
      if (!allocation) throw new Error("Missing allocation");
      return { payment: prior.data, allocation: allocation.data, reused: true };
    }
    if (attempt.state === "confirmed")
      throw new Error("Attempt already has a confirmed payment");
    const payment: Payment = {
      id: crypto.randomUUID(),
      scope: i.scope,
      invoice: attempt.data.invoice,
      attemptId: i.attemptId,
      providerPaymentId: i.providerPaymentId,
      money: money(i.money.minorUnits, i.money.currency),
      confirmedAt: i.confirmedAt,
    };
    const allocation: Allocation = {
      id: crypto.randomUUID(),
      paymentId: payment.id,
      invoiceId: payment.invoice.invoiceId,
      money: payment.money,
    };
    await save(
      ctx,
      i.scope,
      "payment",
      payment,
      payment.invoice.invoiceId,
      i.confirmedAt,
      key,
      sk(i.scope),
    );
    await save(
      ctx,
      i.scope,
      "allocation",
      allocation,
      payment.invoice.invoiceId,
      i.confirmedAt,
      uk(i.scope, "allocation", payment.id),
      sk(i.scope),
    );
    await change(
      ctx,
      attempt,
      {
        ...attempt.data,
        state: "confirmed",
        providerPaymentId: i.providerPaymentId,
        lease: undefined,
        updatedAt: i.confirmedAt,
      },
      i.confirmedAt,
    );
    const projectionMatched = await projectInvoice(ctx, payment, i.confirmedAt);
    await audit(
      ctx,
      i.scope,
      payment.invoice.invoiceId,
      "payment.confirmed",
      i.confirmedAt,
      {
        paymentId: payment.id,
        projectionMatched,
        minorUnits: payment.money.minorUnits,
        currency: payment.money.currency,
      },
    );
    return { payment, allocation, reused: false };
  },
});
async function projectInvoice(ctx: Write, payment: Payment, now: number) {
  const row = await ctx.db
    .query("invoices")
    .withIndex("by_user_id", (q) =>
      q.eq("userId", payment.scope.userId).eq("id", payment.invoice.invoiceId),
    )
    .unique();
  if (
    !row ||
    row.status !== "sent" ||
    String(row.updatedAt) !== payment.invoice.revision
  )
    return false;
  const { _id, _creationTime, userId, ...invoice } = row;
  if (invoiceFingerprint(invoice) !== payment.invoice.fingerprint) return false;
  await ctx.db.patch(row._id, { status: "paid", updatedAt: now });
  const rev = await ctx.db
    .query("workspaceRevisions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (rev) await ctx.db.patch(rev._id, { revision: rev.revision + 1 });
  else await ctx.db.insert("workspaceRevisions", { userId, revision: 1 });
  return true;
}
export const applyRefundOutcome = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: raw }) => {
    const i = raw as RefundOutcomeInput;
    scope(i.scope, userId);
    timestamp(i.observedAt);
    await source(ctx, i);
    const value = money(i.money.minorUnits, i.money.currency);
    if (
      !["pending", "failed", "confirmed"].includes(i.state) ||
      value.minorUnits === 0
    )
      throw new Error("Invalid refund");
    const payment = await find(
      ctx,
      providerIdentityKey(i.scope, `payment:${i.providerPaymentId}`),
    );
    if (!payment)
      throw new Error("Refund parent payment not yet received; retry");
    if (payment.data.money.currency !== value.currency)
      throw new Error("Refund currency mismatch");
    const key = providerIdentityKey(i.scope, `refund:${i.providerRefundId}`);
    const prior = await find(ctx, key);
    if (prior) {
      if (prior.data.providerPaymentId !== i.providerPaymentId)
        throw new Error("Refund parent conflict");
      assertSameMoney(prior.data.money, value);
      if (
        prior.state === "confirmed" ||
        (prior.state === i.state &&
          (prior.data.failure ?? "") === (i.failure ?? ""))
      )
        return { refund: prior.data, reused: true };
    }
    const refund: Refund = {
      id: prior?.data.id ?? crypto.randomUUID(),
      scope: i.scope,
      paymentId: payment.data.id,
      providerPaymentId: i.providerPaymentId,
      providerRefundId: i.providerRefundId,
      money: value,
      state: nextRefundState(prior?.data.state, i.state),
      updatedAt: i.observedAt,
      ...(i.failure ? { failure: i.failure } : {}),
    };
    if (refund.state === "confirmed") {
      const all = await ctx.db
        .query("financialRecords")
        .withIndex("by_invoice_kind", (q) =>
          q
            .eq("userId", userId)
            .eq("workspaceId", i.scope.workspaceId)
            .eq("invoiceId", payment.invoiceId)
            .eq("kind", "refund"),
        )
        .take(201);
      if (all.length > 200)
        throw new Error("Invoice refund history limit exceeded");
      netConfirmedMoney(payment.data.money, [
        ...all
          .filter(
            (r) =>
              r.data.paymentId === payment.data.id &&
              r.state === "confirmed" &&
              r.uniqueKey !== key,
          )
          .map((r) => r.data.money),
        value,
      ]);
    }
    if (prior) await change(ctx, prior, refund, i.observedAt);
    else
      await save(
        ctx,
        i.scope,
        "refund",
        refund,
        payment.invoiceId,
        i.observedAt,
        key,
        sk(i.scope),
      );
    await audit(
      ctx,
      i.scope,
      payment.invoiceId,
      `refund.${refund.state}`,
      i.observedAt,
      {
        refundId: refund.id,
        paymentId: refund.paymentId,
        minorUnits: value.minorUnits,
        currency: value.currency,
      },
    );
    return { refund, reused: false };
  },
});
export const recordManualEvidence = serverMutation({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input: i }) => {
    workspace(i.workspace, userId);
    timestamp(i.recordedAt);
    if (!i.invoiceId || !i.actor?.id || typeof i.note !== "string")
      throw new Error("Invalid evidence");
    const evidence: ManualPaymentEvidence = {
      ...i,
      id: crypto.randomUUID(),
      money: money(i.money.minorUnits, i.money.currency),
    };
    await save(ctx, i.workspace, "manual", evidence, i.invoiceId, i.recordedAt);
    await audit(
      ctx,
      i.workspace,
      i.invoiceId,
      "manual.evidence",
      i.recordedAt,
      { evidenceId: evidence.id },
      i.actor,
    );
    return evidence;
  },
});
export const listPayments = ownerQuery({
  args: { userId: v.string(), workspace: v.any(), query: v.any() },
  handler: async (ctx, { userId, workspace: w, query: q }) => {
    workspace(w, userId);
    if ("accountId" in w) {
      scope(w, userId);
      const limit = pageLimit(q);
      const result = await ctx.db
        .query("financialRecords")
        .withIndex("by_scope_kind", (x) =>
          x.eq("scopeKey", sk(w)).eq("kind", "payment"),
        )
        .paginate({
          cursor: q.cursor ?? null,
          numItems: limit,
          maximumRowsRead: 1000,
        });
      return clean({
        items: result.page.map((row) => row.data),
        nextCursor: result.isDone ? undefined : result.continueCursor,
      });
    }
    return list(ctx, w, "payment", q);
  },
});
export const getInvoiceTimeline = ownerQuery({
  args: {
    userId: v.string(),
    workspace: v.any(),
    invoiceId: v.string(),
    query: v.any(),
  },
  handler: async (ctx, { userId, workspace: w, invoiceId, query: q }) => {
    workspace(w, userId);
    const result: any = { audit: await list(ctx, w, "audit", q, invoiceId) };
    for (const [kind, name] of [
      ["attempt", "attempts"],
      ["payment", "payments"],
      ["allocation", "allocations"],
      ["refund", "refunds"],
      ["manual", "manualEvidence"],
    ] as const) {
      const rows = await ctx.db
        .query("financialRecords")
        .withIndex("by_invoice_kind", (x) =>
          x
            .eq("userId", userId)
            .eq("workspaceId", w.workspaceId)
            .eq("invoiceId", invoiceId)
            .eq("kind", kind),
        )
        .take(201);
      if (rows.length > 200) throw new Error("Invoice timeline limit exceeded");
      result[name] = rows.map((r) => r.data);
    }
    return result;
  },
});
export const listResumableWork = ownerQuery({
  args: { userId: v.string(), scope: v.any(), now: v.number(), query: v.any() },
  handler: async (ctx, { userId, scope: s, now, query: q }) => {
    scope(s, userId);
    timestamp(now);
    pageLimit(q);
    // Stable native cursor over a single indexed scope, including expired dispatch leases.
    const rows = ctx.db
      .query("financialRecords")
      .withIndex("by_scope_kind", (x) => x.eq("scopeKey", sk(s)))
      .filter((x) =>
        x.or(
          x.and(
            x.eq(x.field("kind"), "attempt"),
            x.or(
              x.eq(x.field("state"), "prepared"),
              x.eq(x.field("state"), "pending"),
              x.eq(x.field("state"), "unknown"),
              x.and(
                x.eq(x.field("state"), "dispatching"),
                x.lte(x.field("availableAt"), now),
              ),
            ),
          ),
          x.and(
            x.eq(x.field("kind"), "event"),
            x.or(
              x.eq(x.field("state"), "received"),
              x.and(
                x.or(
                  x.eq(x.field("state"), "retry"),
                  x.eq(x.field("state"), "processing"),
                ),
                x.lte(x.field("availableAt"), now),
              ),
            ),
          ),
        ),
      );
    const p = await rows.paginate({
      cursor: q.cursor ?? null,
      numItems: q.limit,
      maximumRowsRead: 1000,
    });
    return clean({
      items: p.page.map((r) => r.data),
      nextCursor: p.isDone ? undefined : p.continueCursor,
    });
  },
});
export const claimOutbox = serverMutation({
  args: {
    userId: v.string(),
    workspace: v.any(),
    now: v.number(),
    lease: v.any(),
  },
  handler: async (ctx, { userId, workspace: w, now, lease }) => {
    workspace(w, userId);
    validateLease(lease, now);
    let row: null | NonNullable<Awaited<ReturnType<typeof find>>> = null;
    for (const state of ["pending", "failed", "delivering"]) {
      const candidate = await ctx.db
        .query("financialRecords")
        .withIndex("by_owner_state", (q) =>
          q
            .eq("userId", userId)
            .eq("workspaceId", w.workspaceId)
            .eq("kind", "outbox")
            .eq("state", state)
            .lte("availableAt", now),
        )
        .first();
      if (candidate && (!row || candidate.availableAt < row.availableAt))
        row = candidate;
    }
    if (!row) return null;
    const next: OutboxRecord = {
      ...row.data,
      state: "delivering",
      attempts: row.data.attempts + 1,
      lease,
    };
    await ctx.db.patch(row._id, {
      data: clean(next),
      state: "delivering",
      availableAt: lease.expiresAt,
    });
    return next;
  },
});
export const finishOutbox = serverMutation({
  args: {
    userId: v.string(),
    workspace: v.any(),
    id: v.string(),
    leaseToken: v.string(),
    result: v.any(),
  },
  handler: async (ctx, { userId, workspace: w, id, leaseToken, result: r }) => {
    workspace(w, userId);
    timestamp(r.now);
    const row = await record(ctx, w, "outbox", id);
    if (
      !row ||
      row.state !== "delivering" ||
      row.data.lease?.token !== leaseToken ||
      row.data.lease.expiresAt <= r.now
    )
      throw new Error("Stale outbox lease");
    if (!r.delivered) {
      timestamp(r.retryAt);
      if (r.retryAt < r.now) throw new Error("Invalid retry time");
    }
    await change(
      ctx,
      row,
      {
        ...row.data,
        state: r.delivered ? "delivered" : "failed",
        lease: undefined,
        availableAt: r.delivered ? r.now : r.retryAt,
        failure: r.failure,
      },
      r.now,
    );
  },
});
