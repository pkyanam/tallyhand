import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FinancialStore,
  PrepareAttemptInput,
  ClaimInput,
  DispatchResult,
  ReconciliationResult,
  PaymentOutcomeInput,
  RefundOutcomeInput,
} from "../../core/financial/store";
import type {
  FinancialScope,
  WorkspaceIdentity,
  PaymentAttempt,
  ProviderEvent,
  Payment,
  Allocation,
  Refund,
  ManualPaymentEvidence,
  AuditEvent,
  OutboxRecord,
  Lease,
  PageQuery,
  Page,
} from "../../core/financial/types";
import {
  assertPaymentOutcome,
  freezeInvoiceSnapshot,
  providerIdentityKey,
  nextRefundState,
  confirmedRefundBalance,
} from "../../core/financial/invariants";
import {
  assertFinancialGrant,
  assertFinancialDispatchActor,
  type FinancialGrant,
  type FinancialGrantProof,
} from "../../core/financial/authority";
import { invoiceFingerprint } from "../../core/financial/snapshot";
import {
  assertSameMoney,
  legacyTotalToMoney,
  money,
} from "../../core/financial/money";

export function sqliteInvoiceFingerprint(invoice: unknown): string {
  return invoiceFingerprint(invoice);
}
const workspaceKey = (w: WorkspaceIdentity) =>
  JSON.stringify([w.userId, w.workspaceId]);
const scopeKey = (s: FinancialScope) => providerIdentityKey(s, "scope");
type Row = { id: string; data: string };
/** Synchronous SQLite writes execute in one BEGIN IMMEDIATE transaction before promises resolve. */
export class SqliteFinancialStore implements FinancialStore {
  private db: DatabaseSync;
  constructor(
    path: string,
    private readonly owner: WorkspaceIdentity = {
      userId: "local",
      workspaceId: "local",
    },
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS financial_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, workspace TEXT NOT NULL, scope TEXT, identity TEXT, invoice TEXT, data TEXT NOT NULL, UNIQUE(kind,identity));
      CREATE INDEX IF NOT EXISTS financial_workspace ON financial_records(workspace,kind,id);
      CREATE INDEX IF NOT EXISTS financial_invoice ON financial_records(workspace,invoice,kind);
      CREATE INDEX IF NOT EXISTS financial_scope ON financial_records(scope,kind,id);
      CREATE TABLE IF NOT EXISTS financial_grants (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,data TEXT NOT NULL,revoked_at BIGINT);
      CREATE TABLE IF NOT EXISTS financial_operations (identity TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, attempt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS financial_invoice_freezes (attempt TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private get<T>(
    kind: string,
    id: string,
    workspace?: WorkspaceIdentity,
  ): T | null {
    const r = this.db
      .prepare(
        "SELECT data FROM financial_records WHERE kind=? AND id=?" +
          (workspace ? " AND workspace=?" : ""),
      )
      .get(kind, id, ...(workspace ? [workspaceKey(workspace)] : [])) as
      Row | undefined;
    return r ? JSON.parse(r.data) : null;
  }
  private scoped<T>(kind: string, id: string, scope: FinancialScope): T | null {
    const r = this.db
      .prepare(
        "SELECT data FROM financial_records WHERE kind=? AND id=? AND scope=?",
      )
      .get(kind, id, scopeKey(scope)) as Row | undefined;
    return r ? JSON.parse(r.data) : null;
  }
  private identity<T>(kind: string, identity: string): T | null {
    const r = this.db
      .prepare("SELECT data FROM financial_records WHERE kind=? AND identity=?")
      .get(kind, identity) as Row | undefined;
    return r ? JSON.parse(r.data) : null;
  }
  private put<T extends { id: string }>(
    kind: string,
    record: T,
    workspace: WorkspaceIdentity,
    scope?: FinancialScope,
    identity?: string,
    invoice?: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO financial_records(id,kind,workspace,scope,identity,invoice,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(
        record.id,
        kind,
        workspaceKey(workspace),
        scope ? scopeKey(scope) : null,
        identity ?? null,
        invoice ?? null,
        JSON.stringify(record),
      );
  }
  private all<T>(
    kind: string,
    w: WorkspaceIdentity,
    filter = "",
    args: (string | number)[] = [],
  ): T[] {
    const rows = this.db
      .prepare(
        "SELECT data FROM financial_records WHERE kind=? AND workspace=?" +
          filter +
          " ORDER BY id LIMIT 201",
      )
      .all(kind, workspaceKey(w), ...args) as Row[];
    if (rows.length > 200)
      throw new Error("Financial query exceeds bounded result; narrow query");
    return rows.map((r) => JSON.parse(r.data));
  }
  private recordsPage<T extends { id: string }>(
    kind: string,
    w: WorkspaceIdentity,
    q: PageQuery,
    invoiceId?: string,
    scope?: FinancialScope,
  ): Page<T> {
    this.page([], q);
    const rows = this.db
      .prepare(
        "SELECT data FROM financial_records WHERE kind=? AND workspace=? AND id>?" +
          (invoiceId ? " AND invoice=?" : "") +
          (scope ? " AND scope=?" : "") +
          " ORDER BY id LIMIT ?",
      )
      .all(
        kind,
        workspaceKey(w),
        q.cursor ?? "",
        ...(invoiceId ? [invoiceId] : []),
        ...(scope ? [scopeKey(scope)] : []),
        q.limit + 1,
      ) as Row[];
    return this.page(
      rows.map((r) => JSON.parse(r.data)),
      q,
    );
  }
  private page<T extends { id: string }>(items: T[], q: PageQuery): Page<T> {
    if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)
      throw new Error("Page limit must be between 1 and 100");
    const sorted = items
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((x) => !q.cursor || x.id > q.cursor);
    const selected = sorted.slice(0, q.limit);
    return {
      items: selected,
      ...(sorted.length > q.limit
        ? { nextCursor: selected[selected.length - 1].id }
        : {}),
    };
  }
  private audit(
    w: WorkspaceIdentity,
    invoiceId: string,
    kind: string,
    actor: AuditEvent["actor"],
    now: number,
    detail: AuditEvent["detail"],
  ) {
    const event: AuditEvent = {
      id: randomUUID(),
      workspace: w,
      invoiceId,
      kind,
      actor,
      createdAt: now,
      detail,
    };
    this.put("audit", event, w, undefined, undefined, invoiceId);
    const out: OutboxRecord = {
      id: randomUUID(),
      workspace: w,
      auditEventId: event.id,
      topic: kind,
      payload: JSON.stringify(event),
      state: "pending",
      attempts: 0,
      availableAt: now,
    };
    this.put("outbox", out, w);
  }
  private invoiceRow(id: string): { data: string; status: string } | undefined {
    const exists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'",
      )
      .get();
    return exists
      ? (this.db
          .prepare("SELECT data,status FROM invoices WHERE id=?")
          .get(id) as { data: string; status: string } | undefined)
      : undefined;
  }
  private authority(
    actor: PaymentAttempt["actor"],
    scope: FinancialScope,
    invoice: PaymentAttempt["invoice"],
    proof?: FinancialGrantProof,
  ) {
    if (actor.kind === "customer")
      throw Object.assign(
        new Error(
          "SQLite customer collection unavailable: durable share capability store required",
        ),
        { status: 403 },
      );
    if (actor.kind !== "agent") return;
    if (
      !proof ||
      proof.action !== "collect" ||
      scopeKey(proof.scope) !== scopeKey(scope) ||
      proof.invoiceId !== invoice.invoiceId ||
      !proof.money
    )
      throw new Error("Financial authority denied");
    const principalId =
      proof.principal.kind === "api-token"
        ? proof.principal.tokenId
        : proof.principal.clientId;
    if (actor.id !== principalId) throw new Error("Financial actor mismatch");
    assertSameMoney(proof.money, invoice.money);
    const row = this.db
      .prepare(
        "SELECT data,revoked_at FROM financial_grants WHERE id=? AND user_id=? AND workspace_id=?",
      )
      .get(proof.grantId, scope.userId, scope.workspaceId) as
      { data: string; revoked_at: number | null } | undefined;
    const grant: FinancialGrant | null = row
      ? { ...JSON.parse(row.data), revokedAt: row.revoked_at }
      : null;
    assertFinancialGrant(grant, proof);
    if (
      proof.principal.kind === "api-token" &&
      !this.db
        .prepare("SELECT id FROM api_tokens WHERE id=? AND user_id=?")
        .get(proof.principal.tokenId, scope.userId)
    )
      throw new Error("Financial token revoked");
  }
  async prepareAttempt(i: PrepareAttemptInput) {
    return this.tx(() => {
      const invoice = freezeInvoiceSnapshot(i.invoice);
      if (workspaceKey(i.scope) !== workspaceKey(this.owner))
        throw new Error("Legacy invoice owner mismatch");
      if (!this.invoiceRow(invoice.invoiceId))
        throw new Error("Invoice missing");
      this.authority(i.actor, i.scope, invoice, i.authorityProof);
      const op = providerIdentityKey(i.scope, i.operationId);
      const prior = this.db
        .prepare(
          "SELECT fingerprint,attempt FROM financial_operations WHERE identity=?",
        )
        .get(op) as { fingerprint: string; attempt: string } | undefined;
      if (prior) {
        if (prior.fingerprint !== i.requestFingerprint)
          throw new Error("Operation fingerprint conflict");
        return {
          attempt: this.scoped<PaymentAttempt>(
            "attempt",
            prior.attempt,
            i.scope,
          )!,
          reused: true,
        };
      }
      let outstanding: PaymentAttempt | undefined = this.all<PaymentAttempt>(
        "attempt",
        i.scope,
        " AND invoice=? AND json_extract(data,'$.state')!='failed'",
        [invoice.invoiceId],
      )[0];
      if (outstanding && scopeKey(outstanding.scope) !== scopeKey(i.scope))
        throw new Error(
          "Invoice already has a payment intent in another provider scope",
        );
      if (outstanding?.state === "confirmed")
        throw new Error("Invoice already has a confirmed frozen allocation");
      if (
        outstanding &&
        JSON.stringify(outstanding.invoice) !== JSON.stringify(invoice)
      ) {
        if (outstanding.state !== "prepared")
          throw new Error("Frozen invoice conflict");
        this.put(
          "attempt",
          {
            ...outstanding,
            state: "failed",
            failure: "Invoice changed before dispatch",
            updatedAt: i.now,
          },
          i.scope,
        );
        this.audit(
          i.scope,
          invoice.invoiceId,
          "payment.superseded",
          i.actor,
          i.now,
          { attemptId: outstanding.id },
        );
        outstanding = undefined;
      }
      let attempt = outstanding;
      if (!attempt) {
        const row = this.invoiceRow(invoice.invoiceId);
        if (row) {
          if (workspaceKey(i.scope) !== workspaceKey(this.owner))
            throw new Error("Legacy invoice owner mismatch");
          const doc = JSON.parse(row.data);
          if (
            String(doc.updatedAt) !== invoice.revision ||
            invoiceFingerprint(doc) !== invoice.fingerprint
          )
            throw new Error("Invoice snapshot mismatch");
          if (row.status !== "sent" || doc.status !== "sent")
            throw new Error("Invoice must be sent");
          assertSameMoney(
            legacyTotalToMoney(doc.total, doc.currency ?? "USD"),
            invoice.money,
          );
        }
        const id = randomUUID();
        attempt = {
          id,
          requestId: randomUUID(),
          scope: i.scope,
          invoice,
          operationId: i.operationId,
          requestFingerprint: i.requestFingerprint,
          providerIdempotencyKey: `tallyhand:${id}`,
          actor: i.actor,
          state: "prepared",
          createdAt: i.now,
          updatedAt: i.now,
        };
        this.put(
          "attempt",
          attempt,
          i.scope,
          i.scope,
          undefined,
          invoice.invoiceId,
        );
        if (row)
          this.db
            .prepare("INSERT INTO financial_invoice_freezes VALUES(?,?)")
            .run(id, row.data);
        this.audit(
          i.scope,
          invoice.invoiceId,
          "payment.prepared",
          i.actor,
          i.now,
          { attemptId: id },
        );
      }
      this.db
        .prepare("INSERT INTO financial_operations VALUES(?,?,?)")
        .run(op, i.requestFingerprint, attempt.id);
      return { attempt, reused: !!outstanding };
    });
  }
  async getAttempt(s: FinancialScope, id: string) {
    return this.scoped<PaymentAttempt>("attempt", id, s);
  }
  private lease(input: ClaimInput) {
    if (!input.lease.token || input.lease.expiresAt <= input.now)
      throw new Error("Invalid lease");
  }
  async claimAttemptDispatch(
    i: ClaimInput & { readonly dispatchActor: PaymentAttempt["actor"] },
  ) {
    return this.tx(() => {
      this.lease(i);
      const a = this.scoped<PaymentAttempt>("attempt", i.id, i.scope);
      if (!a || a.state !== "prepared") return null;
      assertFinancialDispatchActor(
        i.dispatchActor,
        i.scope,
        i.authorityProof,
        i.capabilityProof,
      );
      this.authority(i.dispatchActor, i.scope, a.invoice, i.authorityProof);
      const frozen = this.db
        .prepare("SELECT data FROM financial_invoice_freezes WHERE attempt=?")
        .get(a.id) as Row | undefined;
      const current = this.invoiceRow(a.invoice.invoiceId);
      if (
        !frozen ||
        !current ||
        current.data !== frozen.data ||
        current.status !== "sent"
      )
        throw new Error("Invoice changed before dispatch");
      const next = {
        ...a,
        state: "dispatching" as const,
        lease: i.lease,
        updatedAt: i.now,
      };
      this.put("attempt", next, i.scope);
      this.audit(
        i.scope,
        a.invoice.invoiceId,
        "payment.dispatch.claimed",
        i.dispatchActor,
        i.now,
        { attemptId: a.id },
      );
      return next;
    });
  }
  async recordAttemptDispatch(i: ClaimInput & { result: DispatchResult }) {
    return this.tx(() => {
      const a = this.scoped<PaymentAttempt>("attempt", i.id, i.scope);
      if (!a) throw new Error("Attempt missing");
      if (a.state === "confirmed") return a;
      if (
        a.state !== "dispatching" ||
        a.lease?.token !== i.lease.token ||
        a.lease.expiresAt <= i.now
      )
        throw new Error("Stale dispatch lease");
      const next = { ...a, ...i.result, lease: undefined, updatedAt: i.now };
      this.put("attempt", next, i.scope);
      return next;
    });
  }
  async reconcileAttempt(i: {
    scope: FinancialScope;
    id: string;
    now: number;
    result: ReconciliationResult;
  }): Promise<PaymentAttempt> {
    return this.tx(() => {
      const a = this.scoped<PaymentAttempt>("attempt", i.id, i.scope);
      if (!a) throw new Error("Attempt missing");
      if (a.state === "confirmed") return a;
      if (
        a.checkoutSessionId &&
        a.checkoutSessionId !== i.result.checkoutSessionId
      )
        throw new Error("Checkout session conflict");
      if (
        a.providerPaymentId &&
        i.result.providerPaymentId &&
        a.providerPaymentId !== i.result.providerPaymentId
      )
        throw new Error("Provider payment identity conflict");
      if (
        !i.result.checkoutSessionId ||
        (i.result.state === "pending" && !i.result.checkoutUrl)
      )
        throw new Error("Reconciliation requires existing checkout");
      if (a.state === "failed") return a;
      if (!["unknown", "pending", "dispatching"].includes(a.state))
        throw new Error("Attempt cannot be reconciled to pending");
      if (a.state === "dispatching" && (a.lease?.expiresAt ?? 0) > i.now)
        throw new Error("Dispatch lease is still active");
      const next: PaymentAttempt = {
        ...a,
        ...i.result,
        checkoutUrl:
          i.result.state === "failed" ? undefined : i.result.checkoutUrl,
        providerPaymentId: i.result.providerPaymentId ?? a.providerPaymentId,
        lease: undefined,
        updatedAt: i.now,
      };
      this.put("attempt", next, i.scope);
      this.audit(
        i.scope,
        a.invoice.invoiceId,
        "payment.reconciled",
        { kind: "system", id: "provider" },
        i.now,
        { attemptId: a.id },
      );
      return next;
    });
  }
  async receiveProviderEvent(
    i: Omit<ProviderEvent, "id" | "state" | "lease" | "retryAt" | "failure">,
  ) {
    return this.tx(() => {
      const key = providerIdentityKey(i.scope, i.providerEventId);
      const existing = this.identity<ProviderEvent>("event", key);
      if (existing) return { event: existing, reused: true };
      const event: ProviderEvent = {
        ...i,
        id: randomUUID(),
        state: "received",
      };
      this.put("event", event, i.scope, i.scope, key);
      return { event, reused: false };
    });
  }
  async claimProviderEvent(i: ClaimInput) {
    return this.tx(() => {
      this.lease(i);
      const e = this.scoped<ProviderEvent>("event", i.id, i.scope);
      if (
        !e ||
        e.state === "processed" ||
        e.state === "quarantined" ||
        (e.state === "processing" && e.lease && e.lease.expiresAt > i.now) ||
        (e.retryAt ?? 0) > i.now
      )
        return null;
      const next = { ...e, state: "processing" as const, lease: i.lease };
      this.put("event", next, i.scope);
      return next;
    });
  }
  async finishProviderEvent(
    i: ClaimInput & {
      state: "processed" | "retry" | "quarantined";
      retryAt?: number;
      failure?: string;
    },
  ) {
    this.tx(() => {
      const e = this.scoped<ProviderEvent>("event", i.id, i.scope);
      if (
        !e ||
        e.state !== "processing" ||
        e.lease?.token !== i.lease.token ||
        e.lease.expiresAt <= i.now
      )
        throw new Error("Stale event lease");
      this.put(
        "event",
        {
          ...e,
          state: i.state,
          retryAt: i.retryAt,
          failure: i.failure,
          lease: undefined,
        },
        i.scope,
      );
    });
  }
  private source(s: FinancialScope, source: PaymentOutcomeInput["source"]) {
    if (
      source.kind === "event" &&
      !this.scoped<ProviderEvent>("event", source.eventId, s)
    )
      throw new Error("Durable provider event receipt required");
  }
  async applyPaymentOutcome(i: PaymentOutcomeInput) {
    return this.tx(() => {
      this.source(i.scope, i.source);
      const a = this.scoped<PaymentAttempt>("attempt", i.attemptId, i.scope);
      if (!a) throw new Error("Attempt missing");
      assertPaymentOutcome(a, i);
      const key = providerIdentityKey(i.scope, i.providerPaymentId);
      const prior = this.identity<Payment>("payment", key);
      if (prior) {
        if (prior.attemptId !== a.id)
          throw new Error("Payment already belongs to another attempt");
        assertSameMoney(prior.money, i.money);
        return {
          payment: prior,
          allocation: this.identity<Allocation>("allocation", prior.id)!,
          reused: true,
        };
      }
      if (a.state === "confirmed") throw new Error("Attempt already paid");
      const frozen = this.db
        .prepare("SELECT data FROM financial_invoice_freezes WHERE attempt=?")
        .get(a.id) as Row | undefined;
      const row = this.invoiceRow(a.invoice.invoiceId);
      const projectionMatches =
        !!frozen &&
        !!row &&
        workspaceKey(i.scope) === workspaceKey(this.owner) &&
        row.data === frozen.data &&
        row.status === "sent";
      if (projectionMatches) {
        const doc = JSON.parse(row!.data);
        const next = { ...doc, status: "paid", updatedAt: i.confirmedAt };
        this.db
          .prepare(
            "UPDATE invoices SET status='paid',updated_at=?,data=? WHERE id=?",
          )
          .run(i.confirmedAt, JSON.stringify(next), a.invoice.invoiceId);
      } else {
        this.audit(
          i.scope,
          a.invoice.invoiceId,
          "payment.invoice-projection-blocked",
          { kind: "system", id: "provider" },
          i.confirmedAt,
          {
            attemptId: a.id,
            projectionStatus: "blocked",
            failure: "Invoice missing or changed since payment preparation",
          },
        );
      }
      const payment: Payment = {
        id: randomUUID(),
        scope: i.scope,
        invoice: a.invoice,
        attemptId: a.id,
        providerPaymentId: i.providerPaymentId,
        money: money(i.money.minorUnits, i.money.currency),
        confirmedAt: i.confirmedAt,
      };
      const allocation: Allocation = {
        id: randomUUID(),
        paymentId: payment.id,
        invoiceId: a.invoice.invoiceId,
        money: payment.money,
      };
      this.put("payment", payment, i.scope, i.scope, key, a.invoice.invoiceId);
      this.put(
        "allocation",
        allocation,
        i.scope,
        undefined,
        payment.id,
        a.invoice.invoiceId,
      );
      this.put(
        "attempt",
        {
          ...a,
          state: "confirmed",
          providerPaymentId: i.providerPaymentId,
          updatedAt: i.confirmedAt,
          lease: undefined,
        },
        i.scope,
      );
      this.audit(
        i.scope,
        a.invoice.invoiceId,
        "payment.confirmed",
        { kind: "system", id: "provider" },
        i.confirmedAt,
        { paymentId: payment.id, projectionMatched: projectionMatches },
      );
      return { payment, allocation, reused: false };
    });
  }
  async applyRefundOutcome(i: RefundOutcomeInput) {
    return this.tx(() => {
      this.source(i.scope, i.source);
      const payment = this.identity<Payment>(
        "payment",
        providerIdentityKey(i.scope, i.providerPaymentId),
      );
      if (!payment) throw new Error("Retryable: parent payment missing");
      money(i.money.minorUnits, i.money.currency);
      if (i.money.currency !== payment.money.currency)
        throw new Error("Refund currency mismatch");
      const key = providerIdentityKey(i.scope, i.providerRefundId);
      const old = this.identity<Refund>("refund", key);
      if (old) {
        if (old.paymentId !== payment.id)
          throw new Error("Refund payment mismatch");
        assertSameMoney(old.money, i.money);
        if (old.state === "confirmed" || old.updatedAt > i.observedAt)
          return { refund: old, reused: true };
      }
      const refund: Refund = {
        id: old?.id ?? randomUUID(),
        scope: i.scope,
        paymentId: payment.id,
        providerPaymentId: i.providerPaymentId,
        providerRefundId: i.providerRefundId,
        money: i.money,
        state: nextRefundState(old?.state, i.state),
        updatedAt: i.observedAt,
        failure: i.failure,
      };
      const refunds = this.all<Refund>(
        "refund",
        i.scope,
        " AND scope=? AND json_extract(data,'$.paymentId')=?",
        [scopeKey(i.scope), payment.id],
      ).filter((r) => r.paymentId === payment.id && r.id !== refund.id);
      confirmedRefundBalance(payment.money, [...refunds, refund]);
      this.put(
        "refund",
        refund,
        i.scope,
        i.scope,
        key,
        payment.invoice.invoiceId,
      );
      this.audit(
        i.scope,
        payment.invoice.invoiceId,
        "refund.observed",
        { kind: "system", id: "provider" },
        i.observedAt,
        { refundId: refund.id, state: refund.state },
      );
      return { refund, reused: !!old };
    });
  }
  async recordManualEvidence(i: Omit<ManualPaymentEvidence, "id">) {
    return this.tx(() => {
      money(i.money.minorUnits, i.money.currency);
      const e = { ...i, id: randomUUID() };
      this.put("manual", e, i.workspace, undefined, undefined, i.invoiceId);
      this.audit(
        i.workspace,
        i.invoiceId,
        "payment.manual-evidence",
        i.actor,
        i.recordedAt,
        { evidenceId: e.id },
      );
      return e;
    });
  }
  async getInvoiceTimeline(w: WorkspaceIdentity, id: string, q: PageQuery) {
    const attempts = this.all<PaymentAttempt>("attempt", w, " AND invoice=?", [
      id,
    ]).filter((a) => a.invoice.invoiceId === id);
    const payments = this.all<Payment>("payment", w, " AND invoice=?", [
      id,
    ]).filter((p) => p.invoice.invoiceId === id);
    const ids = new Set(payments.map((p) => p.id));
    return {
      attempts,
      payments,
      allocations: this.all<Allocation>("allocation", w, " AND invoice=?", [
        id,
      ]).filter((a) => a.invoiceId === id),
      refunds: this.all<Refund>("refund", w, " AND invoice=?", [id]).filter(
        (r) => ids.has(r.paymentId),
      ),
      manualEvidence: this.all<ManualPaymentEvidence>(
        "manual",
        w,
        " AND invoice=?",
        [id],
      ).filter((e) => e.invoiceId === id),
      audit: this.recordsPage<AuditEvent>("audit", w, q, id),
    };
  }
  async listPayments(w: WorkspaceIdentity | FinancialScope, q: PageQuery) {
    if (!w.userId || w.workspaceId !== w.userId)
      throw new Error("Workspace identity mismatch");
    return this.recordsPage<Payment>(
      "payment",
      w,
      q,
      undefined,
      "accountId" in w ? w : undefined,
    );
  }
  async listResumableWork(s: FinancialScope, now: number, q: PageQuery) {
    this.page([], q);
    const rows = this.db
      .prepare(
        `SELECT data FROM financial_records WHERE scope=? AND id>? AND (
      (kind='attempt' AND (json_extract(data,'$.state') IN ('prepared','pending','unknown') OR (json_extract(data,'$.state')='dispatching' AND COALESCE(json_extract(data,'$.lease.expiresAt'),0)<=?))) OR
      (kind='event' AND COALESCE(json_extract(data,'$.retryAt'),0)<=? AND (json_extract(data,'$.state') IN ('received','retry') OR (json_extract(data,'$.state')='processing' AND COALESCE(json_extract(data,'$.lease.expiresAt'),0)<=?)))
    ) ORDER BY id LIMIT ?`,
      )
      .all(scopeKey(s), q.cursor ?? "", now, now, now, q.limit + 1) as Row[];
    return this.page<PaymentAttempt | ProviderEvent>(
      rows.map((r) => JSON.parse(r.data)),
      q,
    );
  }

  async claimOutbox(w: WorkspaceIdentity, now: number, lease: Lease) {
    return this.tx(() => {
      if (!lease.token || lease.expiresAt <= now)
        throw new Error("Invalid lease");
      const row = this.db
        .prepare(
          `SELECT data FROM financial_records WHERE kind='outbox' AND workspace=? AND json_extract(data,'$.state')!='delivered' AND json_extract(data,'$.availableAt')<=? AND (json_extract(data,'$.state')!='delivering' OR COALESCE(json_extract(data,'$.lease.expiresAt'),0)<=?) ORDER BY id LIMIT 1`,
        )
        .get(workspaceKey(w), now, now) as Row | undefined;
      const r: OutboxRecord | undefined = row
        ? JSON.parse(row.data)
        : undefined;
      if (!r) return null;
      const next = {
        ...r,
        state: "delivering" as const,
        lease,
        attempts: r.attempts + 1,
      };
      this.put("outbox", next, w);
      return next;
    });
  }
  async finishOutbox(
    w: WorkspaceIdentity,
    id: string,
    token: string,
    result: {
      delivered: boolean;
      now: number;
      retryAt?: number;
      failure?: string;
    },
  ) {
    this.tx(() => {
      const o = this.get<OutboxRecord>("outbox", id, w);
      if (
        !o ||
        o.state !== "delivering" ||
        o.lease?.token !== token ||
        o.lease.expiresAt <= result.now
      )
        throw new Error("Stale outbox lease");
      this.put(
        "outbox",
        {
          ...o,
          state: result.delivered ? "delivered" : "failed",
          lease: undefined,
          availableAt: result.retryAt ?? result.now,
          failure: result.failure,
        },
        w,
      );
    });
  }
}
export function makeSqliteFinancialStore(
  path: string,
  owner?: WorkspaceIdentity,
): SqliteFinancialStore {
  return new SqliteFinancialStore(path, owner);
}
export const createSqliteFinancialStore = makeSqliteFinancialStore;

/** Discover persisted provider scopes, including confirmed collections whose
 * later refunds might need reconciliation. */
export function listSqliteFinancialScopes(
  path: string,
  limit = 100,
  cursor?: string,
  _now = Date.now(),
): Page<FinancialScope> {
  void _now; // Retained for compatibility with scheduler callers; discovery includes historical scopes.
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Scope limit must be between 1 and 100");
  const db = new DatabaseSync(path);
  try {
    const exists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='financial_records'",
      )
      .get();
    if (!exists) return { items: [] };
    const rows = db
      .prepare(
        "SELECT scope,json_extract(data,'$.scope') AS identity FROM financial_records WHERE scope IS NOT NULL AND scope>? AND kind IN ('attempt','payment','event') GROUP BY scope ORDER BY scope LIMIT ?",
      )
      .all(cursor ?? "", limit + 1) as { scope: string; identity: string }[];
    return {
      items: rows.slice(0, limit).map((r) => JSON.parse(r.identity)),
      ...(rows.length > limit ? { nextCursor: rows[limit - 1].scope } : {}),
    };
  } finally {
    db.close();
  }
}

export interface SqliteFinancialRecoveryCheckpoint {
  scopeCursor?: string;
  scopes: Record<
    string,
    {
      workCursor?: string;
      paymentCursor?: string;
      providerCursors?: Record<string, string>;
    }
  >;
}
const RECOVERY_SCHEMA =
  "CREATE TABLE IF NOT EXISTS financial_recovery_checkpoint (id TEXT PRIMARY KEY,data TEXT NOT NULL,lease_token TEXT,lease_expires_at INTEGER)";
export function getSqliteFinancialRecoveryCheckpoint(
  path: string,
): SqliteFinancialRecoveryCheckpoint | null {
  const db = new DatabaseSync(path);
  try {
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='financial_recovery_checkpoint'",
        )
        .get()
    )
      return null;
    const row = db
      .prepare(
        "SELECT data FROM financial_recovery_checkpoint WHERE id='global'",
      )
      .get() as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}
export function claimSqliteFinancialRecoveryRun(
  path: string,
  token: string,
  now: number,
  expiresAt: number,
): boolean {
  if (!token || expiresAt <= now) throw new Error("Invalid recovery lease");
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(RECOVERY_SCHEMA);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT OR IGNORE INTO financial_recovery_checkpoint(id,data) VALUES('global',?)",
      ).run(JSON.stringify({ scopes: {} }));
      const claimed = db
        .prepare(
          "UPDATE financial_recovery_checkpoint SET lease_token=?,lease_expires_at=? WHERE id='global' AND (lease_token IS NULL OR lease_expires_at<=?)",
        )
        .run(token, expiresAt, now);
      db.exec("COMMIT");
      return Number(claimed.changes) === 1;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
export function saveSqliteFinancialRecoveryCheckpoint(
  path: string,
  token: string,
  state: SqliteFinancialRecoveryCheckpoint,
  now: number,
): void {
  if (Object.keys(state.scopes).length > 100)
    throw new Error("Recovery checkpoint exceeds 100 partial scopes");
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("BEGIN IMMEDIATE");
    try {
      const saved = db
        .prepare(
          "UPDATE financial_recovery_checkpoint SET data=?,lease_token=NULL,lease_expires_at=NULL WHERE id='global' AND lease_token=? AND lease_expires_at>?",
        )
        .run(JSON.stringify(state), token, now);
      if (Number(saved.changes) !== 1) throw new Error("Stale recovery lease");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
