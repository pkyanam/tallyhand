import { randomUUID } from "node:crypto";
import { snapshotInvoice } from "@/core/financial/snapshot";
import type { Invoice } from "@/core/entities";
import {
  assertFinancialGrant,
  assertFinancialDispatchActor,
  assertFinancialCapability,
  type FinancialGrant,
  type FinancialGrantProof,
  type FinancialCapabilityProof,
} from "@/core/financial/authority";
import type {
  FinancialStore,
  PrepareAttemptInput,
  ClaimInput,
  DispatchResult,
  PaymentOutcomeInput,
  RefundOutcomeInput,
} from "@/core/financial/store";
import type {
  Allocation,
  AuditEvent,
  FinancialScope,
  InvoiceSnapshot,
  InvoiceTimeline,
  Lease,
  ManualPaymentEvidence,
  OutboxRecord,
  Page,
  PageQuery,
  Payment,
  PaymentAttempt,
  ProviderEvent,
  Refund,
  WorkspaceIdentity,
} from "@/core/financial/types";
import {
  assertFinancialScope,
  assertPaymentOutcome,
  confirmedRefundBalance,
  freezeInvoiceSnapshot,
  nextRefundState,
  providerIdentityKey,
} from "@/core/financial/invariants";
import { assertSameMoney, money } from "@/core/financial/money";

export interface FinancialPgClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface FinancialPgPool {
  connect(): Promise<FinancialPgClient>;
}
const sharedPools = new Map<string, Promise<FinancialPgPool>>();
interface State {
  attempts: PaymentAttempt[];
  events: ProviderEvent[];
  payments: Payment[];
  allocations: Allocation[];
  refunds: Refund[];
  evidence: ManualPaymentEvidence[];
  audit: AuditEvent[];
  outbox: OutboxRecord[];
  operations: Record<string, { attemptId: string; fingerprint: string }>;
}
const empty = (): State => ({
  attempts: [],
  events: [],
  payments: [],
  allocations: [],
  refunds: [],
  evidence: [],
  audit: [],
  outbox: [],
  operations: {},
});
export const FINANCIAL_POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS financial_grants (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,data TEXT NOT NULL,revoked_at BIGINT);
CREATE TABLE IF NOT EXISTS financial_records (
 user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
 provider TEXT, account_id TEXT, mode TEXT, invoice_id TEXT, parent_id TEXT, object_id TEXT,
 status TEXT, available_at BIGINT, lease_expires_at BIGINT, data JSONB NOT NULL,
 PRIMARY KEY(user_id,workspace_id,kind,id)
);
CREATE INDEX IF NOT EXISTS financial_invoice_idx ON financial_records(user_id,workspace_id,invoice_id,kind,id);
CREATE INDEX IF NOT EXISTS financial_work_idx ON financial_records(user_id,workspace_id,kind,status,available_at,id);
CREATE INDEX IF NOT EXISTS financial_object_idx ON financial_records(user_id,workspace_id,provider,account_id,mode,kind,object_id);
CREATE INDEX IF NOT EXISTS financial_parent_idx ON financial_records(user_id,workspace_id,parent_id,kind,id);
CREATE TABLE IF NOT EXISTS financial_provider_identity (
 user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL,
 account_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 kind TEXT NOT NULL, object_id TEXT NOT NULL, record_id TEXT NOT NULL,
 PRIMARY KEY(user_id, workspace_id,provider,account_id,mode,kind,object_id)
);`;

function sameScope(a: FinancialScope, b: FinancialScope) {
  return providerIdentityKey(a, "scope") === providerIdentityKey(b, "scope");
}
function scoped<T extends { id: string; scope: FinancialScope }>(
  records: T[],
  scope: FinancialScope,
  id: string,
): T {
  const record = records.find((r) => r.id === id && sameScope(r.scope, scope));
  if (!record) throw new Error("Financial record not found in scope");
  return record;
}
function boundedLimit(q: PageQuery) {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)
    throw new Error("Page limit must be 1..100");
  return q.limit + 1;
}
function page<T extends { id: string }>(records: T[], q: PageQuery): Page<T> {
  boundedLimit(q);
  const ordered = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const items = ordered
    .filter((r) => !q.cursor || r.id > q.cursor)
    .slice(0, q.limit + 1);
  return {
    items: items.slice(0, q.limit),
    ...(items.length > q.limit ? { nextCursor: items[q.limit - 1].id } : {}),
  };
}
function assertLease(lease: Lease, now: number) {
  if (
    !lease.token ||
    !Number.isFinite(now) ||
    !Number.isFinite(lease.expiresAt) ||
    lease.expiresAt <= now
  )
    throw new Error("Valid lease required");
}
function assertFence(record: { lease?: Lease }, input: ClaimInput) {
  if (
    record.lease?.token !== input.lease.token ||
    record.lease.expiresAt <= input.now
  )
    throw new Error("Stale lease");
}
export interface PostgresFinancialStoreOptions {
  pool?: FinancialPgPool;
  databaseUrl?: string;
  /** Pure synchronous projection from a locked raw invoices row. Must share the checkout snapshot algorithm. */
  invoiceSnapshot?: (row: Readonly<Record<string, unknown>>) => InvoiceSnapshot;
  workspace?: WorkspaceIdentity;
  /** Existing invoices are user scoped. Resolve the one workspace owning that user's legacy invoice table. */
  invoiceWorkspaceId?: (userId: string) => string;
}

/** One checked-out pg connection per transaction; compatible with Neon pooled URLs.
 * Each mutation is serialized by a transaction-scoped advisory lock. Provider
 * identity constraints are independently enforced by PostgreSQL. Provider API calls
 * belong to orchestration, never inside this adapter's transactions.
 */
export class PostgresFinancialStore implements FinancialStore {
  private poolPromise?: Promise<FinancialPgPool>;
  private schemaPromise?: Promise<void>;
  constructor(private readonly options: PostgresFinancialStoreOptions) {}
  private pool() {
    return (this.poolPromise ??= this.options.pool
      ? Promise.resolve(this.options.pool)
      : (async () => {
          const connectionString =
            this.options.databaseUrl ?? process.env.DATABASE_URL;
          if (!connectionString)
            throw new Error("Postgres financial store requires DATABASE_URL");
          const existing = sharedPools.get(connectionString);
          if (existing) return existing;
          const created = (async () => {
            if (new URL(connectionString).hostname.endsWith(".neon.tech")) {
              const { Pool, neonConfig } =
                await import("@neondatabase/serverless");
              const { default: WebSocket } = await import("ws");
              neonConfig.webSocketConstructor = WebSocket;
              return new Pool({
                connectionString,
                max: 5,
              }) as unknown as FinancialPgPool;
            }
            const { Pool } = await import("pg");
            return new Pool({
              connectionString,
              max: 5,
            }) as unknown as FinancialPgPool;
          })();
          sharedPools.set(connectionString, created);
          return created;
        })());
  }
  private async schema() {
    if (!this.schemaPromise)
      this.schemaPromise = (async () => {
        const client = await (await this.pool()).connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('tallyhand.financial.schema', 0))",
          );
          await client.query(FINANCIAL_POSTGRES_SCHEMA);
          await client.query("COMMIT");
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* preserve schema failure */
          }
          throw error;
        } finally {
          client.release();
        }
      })().catch((error) => {
        this.schemaPromise = undefined;
        throw error;
      });
    await this.schemaPromise;
  }
  private async tx<T>(
    workspace: WorkspaceIdentity,
    write: boolean,
    selection: { sql: string; values?: unknown[] },
    operation: (state: State, client: FinancialPgClient) => Promise<T> | T,
  ): Promise<T> {
    if (!workspace.userId || !workspace.workspaceId)
      throw new Error("Workspace identity required");
    if (
      this.options.workspace &&
      (workspace.userId !== this.options.workspace.userId ||
        workspace.workspaceId !== this.options.workspace.workspaceId)
    )
      throw new Error("Financial workspace mismatch");
    await this.schema();
    const client = await (await this.pool()).connect();
    try {
      await client.query("BEGIN");
      // Lock user, not just workspace: the legacy invoices table has no workspace column.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [JSON.stringify(["financial", workspace.userId])],
      );
      const suffix =
        selection.sql.match(/ ORDER BY id LIMIT (?:\$\d+|\d+)$/)?.[0] ?? "";
      const predicate = suffix
        ? selection.sql.slice(0, -suffix.length)
        : selection.sql;
      const result = await client.query(
        `SELECT kind,id,data FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND (${predicate})${suffix}`,
        [workspace.userId, workspace.workspaceId, ...(selection.values ?? [])],
      );
      const state = empty();
      const original = new Map<string, string>();
      for (const row of result.rows) {
        const kind = row.kind as keyof State;
        original.set(`${kind}:${row.id}`, JSON.stringify(row.data));
        if (kind === "operations")
          state.operations[String(row.id)] =
            row.data as State["operations"][string];
        else (state[kind] as unknown[]).push(row.data);
      }
      const value = await operation(state, client);
      if (write)
        for (const kind of Object.keys(state) as (keyof State)[]) {
          const records =
            kind === "operations"
              ? Object.entries(state.operations).map(([id, data]) => ({
                  id,
                  ...data,
                }))
              : state[kind];
          for (const record of records) {
            const r = record as unknown as Record<string, unknown>;
            const id = String(r.id);
            const data =
              kind === "operations"
                ? { attemptId: r.attemptId, fingerprint: r.fingerprint }
                : r;
            if (original.get(`${kind}:${id}`) === JSON.stringify(data))
              continue;
            const scope = (r.scope ?? {}) as Partial<FinancialScope>;
            const invoice = r.invoice as InvoiceSnapshot | undefined;
            const lease = r.lease as Lease | undefined;
            await client.query(
              `INSERT INTO financial_records(user_id,workspace_id,kind,id,provider,account_id,mode,invoice_id,parent_id,object_id,status,available_at,lease_expires_at,data)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
            ON CONFLICT(user_id,workspace_id,kind,id) DO UPDATE SET status=EXCLUDED.status,available_at=EXCLUDED.available_at,lease_expires_at=EXCLUDED.lease_expires_at,data=EXCLUDED.data,object_id=EXCLUDED.object_id`,
              [
                workspace.userId,
                workspace.workspaceId,
                kind,
                id,
                scope.provider ?? null,
                scope.accountId ?? null,
                scope.mode ?? null,
                invoice?.invoiceId ?? r.invoiceId ?? null,
                r.paymentId ?? null,
                r.providerEventId ??
                  r.providerRefundId ??
                  r.providerPaymentId ??
                  null,
                r.state ?? null,
                r.availableAt ?? r.retryAt ?? 0,
                lease?.expiresAt ?? null,
                JSON.stringify(data),
              ],
            );
          }
        }
      await client.query("COMMIT");
      return structuredClone(value);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* preserve original error */
      }
      throw error;
    } finally {
      client.release();
    }
  }
  private async identity(
    client: FinancialPgClient,
    scope: FinancialScope,
    kind: string,
    objectId: string,
    recordId: string,
  ) {
    providerIdentityKey(scope, objectId);
    const values = [
      scope.userId,
      scope.workspaceId,
      scope.provider,
      scope.accountId,
      scope.mode,
      kind,
      objectId,
      recordId,
    ];
    await client.query(
      "INSERT INTO financial_provider_identity(user_id,workspace_id,provider,account_id,mode,kind,object_id,record_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      values,
    );
    const result = await client.query(
      "SELECT record_id FROM financial_provider_identity WHERE user_id=$1 AND workspace_id=$2 AND provider=$3 AND account_id=$4 AND mode=$5 AND kind=$6 AND object_id=$7",
      values.slice(0, 7),
    );
    if (result.rows[0]?.record_id !== recordId)
      throw new Error(
        "Provider identity already belongs to another financial record",
      );
  }
  private audit(
    state: State,
    workspace: WorkspaceIdentity,
    invoiceId: string,
    kind: string,
    now: number,
    detail: AuditEvent["detail"],
    actor: AuditEvent["actor"] = { kind: "system", id: "financial" },
  ) {
    const audit: AuditEvent = {
      id: randomUUID(),
      workspace,
      invoiceId,
      kind,
      createdAt: now,
      detail,
      actor,
    };
    state.audit.push(audit);
    state.outbox.push({
      id: randomUUID(),
      workspace,
      auditEventId: audit.id,
      topic: kind,
      payload: JSON.stringify(audit),
      state: "pending",
      attempts: 0,
      availableAt: now,
    });
  }
  private eventSource(
    state: State,
    scope: FinancialScope,
    source: PaymentOutcomeInput["source"],
  ) {
    if (source.kind === "event") {
      if (
        !state.events.some(
          (e) => sameScope(e.scope, scope) && e.id === source.eventId,
        )
      )
        throw new Error("Provider event not durably received");
    } else if (!source.reference)
      throw new Error("Reconciliation reference required");
  }
  private async authority(
    client: FinancialPgClient,
    actor: PaymentAttempt["actor"],
    scope: FinancialScope,
    invoice: InvoiceSnapshot,
    proof?: FinancialGrantProof,
  ) {
    if (actor.kind !== "agent") return;
    if (
      !proof ||
      proof.action !== "collect" ||
      proof.invoiceId !== invoice.invoiceId
    )
      throw new Error("Machine financial grant required");
    assertFinancialScope(proof.scope, scope);
    if (!proof.money) throw new Error("Machine collection amount required");
    assertSameMoney(proof.money, invoice.money);
    const result = await client.query(
      "SELECT data,revoked_at FROM financial_grants WHERE id=$1 AND user_id=$2 AND workspace_id=$3 FOR UPDATE",
      [proof.grantId, scope.userId, scope.workspaceId],
    );
    const row = result.rows[0];
    const grant = row
      ? ({
          ...JSON.parse(String(row.data)),
          revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
        } as FinancialGrant)
      : null;
    assertFinancialGrant(grant, proof);
    if (proof.principal.kind === "api-token") {
      const token = await client.query(
        "SELECT id FROM api_tokens WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [proof.principal.tokenId, scope.userId],
      );
      if (!token.rows.length || actor.id !== proof.principal.tokenId)
        throw new Error("Machine token no longer active");
    } else if (
      actor.id !== proof.principal.clientId ||
      proof.principal.userId !== scope.userId
    )
      throw new Error("Machine principal mismatch");
  }
  private async capability(
    client: FinancialPgClient,
    actor: PaymentAttempt["actor"],
    scope: FinancialScope,
    invoice: InvoiceSnapshot,
    now: number,
    proof?: FinancialCapabilityProof,
  ) {
    if (actor.kind !== "customer") return;
    if (!proof || actor.id !== proof.linkId)
      throw new Error("Customer financial capability required");
    const result = await client.query(
      "SELECT id,user_id,type,target,expires_at,revoked_at FROM share_links WHERE id=$1 AND user_id=$2 FOR SHARE",
      [proof.linkId, scope.userId],
    );
    const row = result.rows[0];
    assertFinancialCapability(
      row
        ? {
            id: String(row.id),
            userId: String(row.user_id),
            type: String(row.type),
            target: row.target,
            expiresAt: Number(row.expires_at),
            revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
          }
        : null,
      proof,
      scope,
      invoice.invoiceId,
      now,
    );
    const current = await client.query(
      "SELECT cloud_link_enabled FROM invoices WHERE user_id=$1 AND id=$2 FOR SHARE",
      [scope.userId, invoice.invoiceId],
    );
    if (!current.rows.length || current.rows[0].cloud_link_enabled === false)
      throw new Error("Invoice payment capability disabled");
  }
  private async invoice(
    client: FinancialPgClient,
    scope: FinancialScope,
    snapshot: InvoiceSnapshot,
    requireMatch = true,
  ) {
    const workspace =
      this.options.invoiceWorkspaceId?.(scope.userId) ?? scope.userId;
    if (scope.workspaceId !== workspace)
      throw new Error("Invoice workspace mismatch");
    const result = await client.query(
      "SELECT * FROM invoices WHERE user_id=$1 AND id=$2 FOR UPDATE",
      [scope.userId, snapshot.invoiceId],
    );
    const row = result.rows[0];
    try {
      if (!row || row.status !== "sent")
        throw new Error("Invoice is not currently sent");
      const current = freezeInvoiceSnapshot(
        (this.options.invoiceSnapshot ?? rawInvoiceSnapshot)(row),
      );
      if (
        current.invoiceId !== snapshot.invoiceId ||
        current.revision !== snapshot.revision ||
        current.fingerprint !== snapshot.fingerprint
      )
        throw new Error("Frozen invoice no longer matches current invoice");
      assertSameMoney(current.money, snapshot.money);
      return true;
    } catch (error) {
      if (requireMatch) throw error;
      return false;
    }
  }
  prepareAttempt(input: PrepareAttemptInput) {
    return this.tx(
      input.scope,
      true,
      {
        sql: "(invoice_id=$3 AND kind='attempts' AND status<>'failed') OR (kind='operations' AND id=$4) OR (kind='attempts' AND id=(SELECT data->>'attemptId' FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND kind='operations' AND id=$4))",
        values: [
          input.invoice.invoiceId,
          providerIdentityKey(input.scope, input.operationId),
        ],
      },
      async (s, c) => {
        assertFinancialScope(input.scope, input.scope);
        if (!input.operationId || !input.requestFingerprint)
          throw new Error("Operation identity required");
        const invoice = freezeInvoiceSnapshot(input.invoice);
        if (invoice.money.minorUnits <= 0)
          throw new Error("Collection amount must be positive");
        await this.authority(
          c,
          input.actor,
          input.scope,
          invoice,
          input.authorityProof,
        );
        await this.capability(
          c,
          input.actor,
          input.scope,
          invoice,
          input.now,
          input.capabilityProof,
        );
        await this.invoice(c, input.scope, invoice);
        const key = providerIdentityKey(input.scope, input.operationId);
        const op = s.operations[key];
        if (op) {
          if (op.fingerprint !== input.requestFingerprint)
            throw new Error("Operation fingerprint conflict");
          return {
            attempt: scoped(s.attempts, input.scope, op.attemptId),
            reused: true,
          };
        }
        const outstanding = s.attempts.find(
          (a) =>
            a.invoice.invoiceId === invoice.invoiceId && a.state !== "failed",
        );
        if (outstanding) {
          assertFinancialScope(outstanding.scope,input.scope);
          const incompatible = outstanding.invoice.revision !== invoice.revision || outstanding.invoice.fingerprint !== invoice.fingerprint;
          if (incompatible) {
            if (outstanding.state !== "prepared") throw new Error("Outstanding payable attempt targets another invoice scope or revision");
            Object.assign(outstanding,{state:"failed",updatedAt:input.now,failure:"Undispatched intent superseded by current invoice",lease:undefined});
            this.audit(s,input.scope,invoice.invoiceId,"payment.superseded",input.now,{attemptId:outstanding.id},input.actor);
          } else {
            s.operations[key] = {attemptId:outstanding.id,fingerprint:input.requestFingerprint};
            return {attempt:outstanding,reused:true};
          }
        }
        const id = randomUUID();
        const attempt: PaymentAttempt = {
          id,
          requestId: randomUUID(),
          scope: input.scope,
          invoice,
          operationId: input.operationId,
          requestFingerprint: input.requestFingerprint,
          providerIdempotencyKey: `tallyhand_${id}`,
          actor: input.actor,
          state: "prepared",
          createdAt: input.now,
          updatedAt: input.now,
        };
        s.attempts.push(attempt);
        s.operations[key] = {
          attemptId: id,
          fingerprint: input.requestFingerprint,
        };
        this.audit(
          s,
          input.scope,
          invoice.invoiceId,
          "payment.prepared",
          input.now,
          { attemptId: id },
          input.actor,
        );
        return { attempt, reused: false };
      },
    );
  }
  claimAttemptDispatch(input: ClaimInput & {dispatchActor:PaymentAttempt["actor"]}) {
    return this.tx(
      input.scope,
      true,
      { sql: "kind='attempts' AND id=$3", values: [input.id] },
      async (s, c) => {
        assertFinancialDispatchActor(input.dispatchActor,input.scope,input.authorityProof,input.capabilityProof);
        assertLease(input.lease, input.now);
        const a = scoped(s.attempts, input.scope, input.id);
        await this.authority(
          c,
          input.dispatchActor,
          input.scope,
          a.invoice,
          input.authorityProof,
        );
        await this.capability(
          c,
          input.dispatchActor,
          input.scope,
          a.invoice,
          input.now,
          input.capabilityProof,
        );
        if (
          a.state === "dispatching" &&
          (a.lease?.expiresAt ?? 0) <= input.now
        ) {
          Object.assign(a, {
            state: "unknown",
            updatedAt: input.now,
            failure: "Dispatch lease expired; reconciliation required",
            lease: undefined,
          });
          this.audit(
            s,
            input.scope,
            a.invoice.invoiceId,
            "payment.unknown",
            input.now,
            { attemptId: a.id },
          );
          return null;
        }
        if (a.state !== "prepared") return null;
        await this.invoice(c, input.scope, a.invoice);
        Object.assign(a, {
          state: "dispatching",
          lease: input.lease,
          updatedAt: input.now,
        });
        this.audit(
          s,
          input.scope,
          a.invoice.invoiceId,
          "payment.dispatching",
          input.now,
          { attemptId: a.id },
          input.dispatchActor,
        );
        return a;
      },
    );
  }
  recordAttemptDispatch(input: ClaimInput & { result: DispatchResult }) {
    return this.tx(
      input.scope,
      true,
      { sql: "kind='attempts' AND id=$3", values: [input.id] },
      async (s, c) => {
        const a = scoped(s.attempts, input.scope, input.id);
        if (a.state === "confirmed") return a;
        assertFence(a, input);
        if (a.state !== "dispatching")
          throw new Error("Attempt is not dispatching");
        if (input.result.state === "pending") {
          if (!input.result.checkoutSessionId || !input.result.checkoutUrl)
            throw new Error("Checkout session required");
          await this.identity(
            c,
            input.scope,
            "session",
            input.result.checkoutSessionId,
            a.id,
          );
          if (input.result.providerPaymentId)
            await this.identity(
              c,
              input.scope,
              "payment-attempt",
              input.result.providerPaymentId,
              a.id,
            );
        }
        Object.assign(a, input.result, {
          lease: undefined,
          updatedAt: input.now,
        });
        this.audit(
          s,
          input.scope,
          a.invoice.invoiceId,
          `payment.${a.state}`,
          input.now,
          { attemptId: a.id },
        );
        return a;
      },
    );
  }
  reconcileAttempt(input: {
    scope: FinancialScope;
    id: string;
    now: number;
    result: import("@/core/financial/store").ReconciliationResult;
  }) {
    return this.tx(
      input.scope,
      true,
      { sql: "kind='attempts' AND id=$3", values: [input.id] },
      async (s, c) => {
        const a = scoped(s.attempts, input.scope, input.id);
        if (a.state === "confirmed") return a;
        if (a.state === "prepared")
          throw new Error("Prepared attempt has no dispatched checkout to reconcile");
        if (a.state === "dispatching" && (a.lease?.expiresAt ?? 0) > input.now)
          throw new Error("Dispatch lease still active");
        if (!input.result.checkoutSessionId || (input.result.state === "pending" && !input.result.checkoutUrl))
          throw new Error("Checkout session required");
        if (
          (a.checkoutSessionId &&
            a.checkoutSessionId !== input.result.checkoutSessionId) ||
          (a.providerPaymentId &&
            input.result.state === "pending" && input.result.providerPaymentId &&
            a.providerPaymentId !== input.result.providerPaymentId)
        )
          throw new Error("Reconciled provider identity mismatch");
        if (a.state === "failed") {
          if (a.checkoutSessionId !== input.result.checkoutSessionId) throw new Error("Reconciled provider identity mismatch");
          return a;
        }
        await this.identity(
          c,
          input.scope,
          "session",
          input.result.checkoutSessionId,
          a.id,
        );
        if (input.result.state === "pending" && input.result.providerPaymentId)
          await this.identity(
            c,
            input.scope,
            "payment-attempt",
            input.result.providerPaymentId,
            a.id,
          );
        Object.assign(a, input.result, {
          providerPaymentId:
            input.result.state === "pending" ? input.result.providerPaymentId ?? a.providerPaymentId : a.providerPaymentId,
          updatedAt: input.now,
          lease: undefined,
          failure: input.result.state === "failed" ? input.result.failure : undefined,
        });
        this.audit(
          s,
          input.scope,
          a.invoice.invoiceId,
          "payment.reconciled",
          input.now,
          { attemptId: a.id },
        );
        return a;
      },
    );
  }
  getAttempt(scope: FinancialScope, id: string) {
    return this.tx(
      scope,
      false,
      { sql: "kind='attempts' AND id=$3", values: [id] },
      (s) =>
        s.attempts.find((a) => a.id === id && sameScope(a.scope, scope)) ??
        null,
    );
  }
  receiveProviderEvent(
    input: Omit<
      ProviderEvent,
      "id" | "state" | "lease" | "retryAt" | "failure"
    >,
  ) {
    return this.tx(
      input.scope,
      true,
      {
        sql: "kind='events' AND object_id=$3 AND provider=$4 AND account_id=$5 AND mode=$6",
        values: [
          input.providerEventId,
          input.scope.provider,
          input.scope.accountId,
          input.scope.mode,
        ],
      },
      async (s, c) => {
        const existing = s.events.find(
          (e) =>
            sameScope(e.scope, input.scope) &&
            e.providerEventId === input.providerEventId,
        );
        if (existing) {
          if (
            existing.type !== input.type ||
            existing.payload !== input.payload
          )
            throw new Error("Provider event payload conflict");
          return { event: existing, reused: true };
        }
        const event: ProviderEvent = {
          ...input,
          id: randomUUID(),
          state: "received",
        };
        await this.identity(
          c,
          input.scope,
          "event",
          input.providerEventId,
          event.id,
        );
        s.events.push(event);
        this.audit(
          s,
          input.scope,
          "",
          "provider.event.received",
          input.receivedAt,
          { eventId: event.providerEventId },
        );
        return { event, reused: false };
      },
    );
  }
  claimProviderEvent(input: ClaimInput) {
    return this.tx(
      input.scope,
      true,
      { sql: "kind='events' AND id=$3", values: [input.id] },
      (s) => {
        assertLease(input.lease, input.now);
        const e = scoped(s.events, input.scope, input.id);
        if (
          e.state === "processed" ||
          e.state === "quarantined" ||
          (e.state === "processing" && (e.lease?.expiresAt ?? 0) > input.now) ||
          (e.retryAt ?? 0) > input.now
        )
          return null;
        Object.assign(e, { state: "processing", lease: input.lease });
        return e;
      },
    );
  }
  finishProviderEvent(
    input: ClaimInput & {
      state: "processed" | "retry" | "quarantined";
      retryAt?: number;
      failure?: string;
    },
  ) {
    return this.tx(
      input.scope,
      true,
      { sql: "kind='events' AND id=$3", values: [input.id] },
      (s) => {
        const e = scoped(s.events, input.scope, input.id);
        assertFence(e, input);
        if (e.state !== "processing")
          throw new Error("Event is not processing");
        Object.assign(e, {
          state: input.state,
          retryAt: input.retryAt,
          failure: input.failure,
          lease: undefined,
        });
      },
    );
  }
  applyPaymentOutcome(input: PaymentOutcomeInput) {
    return this.tx(
      input.scope,
      true,
      {
        sql: "(kind='attempts' AND id=$3) OR (kind='events' AND id=$4) OR (kind='payments' AND object_id=$5) OR (kind='allocations' AND parent_id IN (SELECT id FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND kind='payments' AND object_id=$5))",
        values: [
          input.attemptId,
          input.source.kind === "event" ? input.source.eventId : "",
          input.providerPaymentId,
        ],
      },
      async (s, c) => {
        this.eventSource(s, input.scope, input.source);
        const a = scoped(s.attempts, input.scope, input.attemptId);
        assertPaymentOutcome(a, input);
        const prior = s.payments.find(
          (p) =>
            sameScope(p.scope, input.scope) &&
            p.providerPaymentId === input.providerPaymentId,
        );
        if (prior) {
          if (prior.attemptId !== a.id)
            throw new Error("Payment belongs to another attempt");
          assertSameMoney(prior.money, input.money);
          return {
            payment: prior,
            allocation: s.allocations.find((x) => x.paymentId === prior.id)!,
            reused: true,
          };
        }
        if (a.state === "confirmed")
          throw new Error("Attempt already confirmed by another payment");
        const projection = await this.invoice(c, input.scope, a.invoice, false);
        const payment: Payment = {
          id: randomUUID(),
          scope: input.scope,
          invoice: a.invoice,
          attemptId: a.id,
          providerPaymentId: input.providerPaymentId,
          money: money(input.money.minorUnits, input.money.currency),
          confirmedAt: input.confirmedAt,
        };
        const allocation: Allocation = {
          id: randomUUID(),
          paymentId: payment.id,
          invoiceId: a.invoice.invoiceId,
          money: payment.money,
        };
        await this.identity(
          c,
          input.scope,
          "payment",
          input.providerPaymentId,
          payment.id,
        );
        await this.identity(
          c,
          input.scope,
          "payment-attempt",
          input.providerPaymentId,
          a.id,
        );
        if (projection) {
          const updated = await c.query(
            "UPDATE invoices SET status='paid', updated_at=$3 WHERE user_id=$1 AND id=$2 AND status='sent'",
            [input.scope.userId, a.invoice.invoiceId, input.confirmedAt],
          );
          if (updated.rowCount !== 1)
            throw new Error("Invoice paid projection failed");
        }
        s.payments.push(payment);
        s.allocations.push(allocation);
        Object.assign(a, {
          state: "confirmed",
          providerPaymentId: input.providerPaymentId,
          updatedAt: input.confirmedAt,
          lease: undefined,
        });
        this.audit(
          s,
          input.scope,
          a.invoice.invoiceId,
          "payment.confirmed",
          input.confirmedAt,
          {
            paymentId: payment.id,
            providerPaymentId: input.providerPaymentId,
            projection,
          },
        );
        return { payment, allocation, reused: false };
      },
    );
  }
  applyRefundOutcome(input: RefundOutcomeInput) {
    return this.tx(
      input.scope,
      true,
      {
        sql: "(kind='events' AND id=$3) OR (kind='payments' AND object_id=$4) OR (kind='refunds' AND parent_id IN (SELECT id FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND kind='payments' AND object_id=$4))",
        values: [
          input.source.kind === "event" ? input.source.eventId : "",
          input.providerPaymentId,
        ],
      },
      async (s, c) => {
        this.eventSource(s, input.scope, input.source);
        const payment = s.payments.find(
          (p) =>
            sameScope(p.scope, input.scope) &&
            p.providerPaymentId === input.providerPaymentId,
        );
        if (!payment)
          throw new Error("Parent payment not found; retry required");
        const amount = money(input.money.minorUnits, input.money.currency);
        if (
          amount.currency !== payment.money.currency ||
          amount.minorUnits <= 0 ||
          amount.minorUnits > payment.money.minorUnits
        )
          throw new Error("Invalid refund amount");
        const previous = s.refunds.find(
          (r) =>
            sameScope(r.scope, input.scope) &&
            r.providerRefundId === input.providerRefundId,
        );
        if (previous) {
          if (previous.paymentId !== payment.id)
            throw new Error("Refund payment mismatch");
          assertSameMoney(previous.money, amount);
        }
        const refund: Refund = {
          ...(previous ?? {
            id: randomUUID(),
            scope: input.scope,
            paymentId: payment.id,
            providerPaymentId: input.providerPaymentId,
            providerRefundId: input.providerRefundId,
            money: amount,
          }),
          state: nextRefundState(previous?.state, input.state),
          updatedAt: input.observedAt,
          failure: input.failure,
        };
        const related = s.refunds.filter(
          (r) => r.paymentId === payment.id && r.id !== refund.id,
        );
        confirmedRefundBalance(payment.money, [...related, refund]);
        await this.identity(
          c,
          input.scope,
          "refund",
          input.providerRefundId,
          refund.id,
        );
        if (!previous || previous.state !== refund.state) {
          s.refunds = s.refunds.filter((r) => r.id !== refund.id);
          s.refunds.push(refund);
          this.audit(
            s,
            input.scope,
            payment.invoice.invoiceId,
            `refund.${refund.state}`,
            input.observedAt,
            { refundId: refund.id },
          );
        }
        return {
          refund: previous?.state === refund.state ? previous : refund,
          reused: !!previous,
        };
      },
    );
  }
  recordManualEvidence(input: Omit<ManualPaymentEvidence, "id">) {
    return this.tx(input.workspace, true, { sql: "FALSE" }, (s) => {
      money(input.money.minorUnits, input.money.currency);
      if (!input.invoiceId || !input.note.trim())
        throw new Error("Manual evidence requires invoice and note");
      const evidence = { ...input, id: randomUUID() };
      s.evidence.push(evidence);
      this.audit(
        s,
        input.workspace,
        input.invoiceId,
        "payment.manual_evidence",
        input.recordedAt,
        { evidenceId: evidence.id },
        input.actor,
      );
      return evidence;
    });
  }
  getInvoiceTimeline(
    workspace: WorkspaceIdentity,
    invoiceId: string,
    q: PageQuery,
  ): Promise<InvoiceTimeline> {
    return this.tx(
      workspace,
      false,
      {
        sql: "(invoice_id=$3 AND kind <> 'audit') OR (kind='refunds' AND parent_id IN (SELECT id FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND kind='payments' AND invoice_id=$3)) OR (kind='audit' AND id IN (SELECT id FROM financial_records WHERE user_id=$1 AND workspace_id=$2 AND kind='audit' AND invoice_id=$3 AND id>$4 ORDER BY id LIMIT $5))",
        values: [invoiceId, q.cursor ?? "", boundedLimit(q)],
      },
      (s) => {
        const payments = s.payments.filter(
          (p) => p.invoice.invoiceId === invoiceId,
        );
        const ids = new Set(payments.map((p) => p.id));
        return {
          attempts: s.attempts.filter((a) => a.invoice.invoiceId === invoiceId),
          payments,
          allocations: s.allocations.filter((a) => ids.has(a.paymentId)),
          refunds: s.refunds.filter((r) => ids.has(r.paymentId)),
          manualEvidence: s.evidence.filter((e) => e.invoiceId === invoiceId),
          audit: page(
            s.audit.filter((a) => a.invoiceId === invoiceId),
            q,
          ),
        };
      },
    );
  }
  listPayments(workspace: WorkspaceIdentity | FinancialScope, q: PageQuery) {
    const financial = "accountId" in workspace;
    return this.tx(
      workspace,
      false,
      {
        sql: `kind='payments' AND id>$3${financial ? " AND provider=$5 AND account_id=$6 AND mode=$7" : ""} ORDER BY id LIMIT $4`,
        values: [
          q.cursor ?? "",
          boundedLimit(q),
          ...(financial
            ? [workspace.provider, workspace.accountId, workspace.mode]
            : []),
        ],
      },
      (s) => page(s.payments, q),
    );
  }
  listResumableWork(scope: FinancialScope, now: number, q: PageQuery) {
    return this.tx(
      scope,
      false,
      {
        sql: "provider=$3 AND account_id=$4 AND mode=$5 AND id>$6 AND ((kind='attempts' AND (status IN ('prepared','unknown','pending') OR (status='dispatching' AND lease_expires_at<=$7))) OR (kind='events' AND (status='received' OR (status='retry' AND available_at<=$7) OR (status='processing' AND lease_expires_at<=$7)))) ORDER BY id LIMIT $8",
        values: [
          scope.provider,
          scope.accountId,
          scope.mode,
          q.cursor ?? "",
          now,
          boundedLimit(q),
        ],
      },
      (s) =>
        page<PaymentAttempt | ProviderEvent>(
          [
            ...s.attempts.filter(
              (a) =>
                sameScope(a.scope, scope) &&
                (a.state === "prepared" ||
                  a.state === "unknown" ||
                  a.state === "pending" ||
                  (a.state === "dispatching" &&
                    (a.lease?.expiresAt ?? 0) <= now)),
            ),
            ...s.events.filter(
              (e) =>
                sameScope(e.scope, scope) &&
                (e.state === "received" ||
                  (e.state === "retry" && (e.retryAt ?? 0) <= now) ||
                  (e.state === "processing" &&
                    (e.lease?.expiresAt ?? 0) <= now)),
            ),
          ],
          q,
        ),
    );
  }
  claimOutbox(workspace: WorkspaceIdentity, now: number, lease: Lease) {
    return this.tx(
      workspace,
      true,
      {
        sql: "kind='outbox' AND status<>'delivered' AND available_at<=$3 AND (status<>'delivering' OR lease_expires_at<=$3) ORDER BY id LIMIT 1",
        values: [now],
      },
      (s) => {
        assertLease(lease, now);
        const record = s.outbox.find(
          (o) =>
            o.state !== "delivered" &&
            o.availableAt <= now &&
            (o.state !== "delivering" || (o.lease?.expiresAt ?? 0) <= now),
        );
        if (!record) return null;
        Object.assign(record, {
          state: "delivering",
          lease,
          attempts: record.attempts + 1,
        });
        return record;
      },
    );
  }
  finishOutbox(
    workspace: WorkspaceIdentity,
    id: string,
    leaseToken: string,
    result: {
      delivered: boolean;
      now: number;
      retryAt?: number;
      failure?: string;
    },
  ) {
    return this.tx(
      workspace,
      true,
      { sql: "kind='outbox' AND id=$3", values: [id] },
      (s) => {
        const o = s.outbox.find((o) => o.id === id);
        if (
          !o ||
          o.state !== "delivering" ||
          o.lease?.token !== leaseToken ||
          o.lease.expiresAt <= result.now
        )
          throw new Error("Stale outbox lease");
        Object.assign(o, {
          state: result.delivered ? "delivered" : "failed",
          availableAt: result.retryAt ?? result.now,
          failure: result.failure,
          lease: undefined,
        });
      },
    );
  }
}

function rawInvoiceSnapshot(
  raw: Readonly<Record<string, unknown>>,
): InvoiceSnapshot {
  const row: Record<string, unknown> = {};
  const numbers = new Set([
    "issueDate",
    "dueDate",
    "subtotal",
    "total",
    "serviceStart",
    "serviceEnd",
    "createdAt",
    "updatedAt",
  ]);
  for (const [key, value] of Object.entries(raw)) {
    if (key === "user_id") continue;
    const camel = key.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    row[camel] =
      value === null ? undefined : numbers.has(camel) ? Number(value) : value;
  }
  return snapshotInvoice(row as unknown as Invoice);
}
export function createPostgresFinancialStore(
  connectionString: string,
  workspace: WorkspaceIdentity,
): FinancialStore {
  return new PostgresFinancialStore({
    databaseUrl: connectionString,
    workspace,
  });
}
