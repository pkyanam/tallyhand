import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import {
  PostgresFinancialStore,
  FINANCIAL_POSTGRES_SCHEMA,
  type FinancialPgClient,
  type FinancialPgPool,
} from "./postgres-store";
import type {
  PaymentAttempt,
  ProviderEvent,
  FinancialScope,
} from "@/core/financial/types";
import { snapshotInvoice } from "@/core/financial/snapshot";
import type { Invoice } from "@/core/entities";
import { createHash } from "node:crypto";
import {
  processFinancialEvent,
  receiveStripeEvent,
} from "@/server/financial-events";

// Scripted SQL adapter checks transaction orchestration and emitted SQL, not real
// PostgreSQL persistence, lock behavior, unique-constraint enforcement or Neon transport.
const scope: FinancialScope = {
  userId: "u",
  workspaceId: "u",
  provider: "stripe",
  accountId: "acct",
  mode: "test",
};
const invoice: Invoice = {
  id: "i",
  clientId: "c",
  invoiceNumber: "1",
  issueDate: 1,
  dueDate: 2,
  status: "sent",
  lineItems: [],
  subtotal: 10,
  total: 10,
  createdAt: 1,
  updatedAt: 2,
};
const snapshot = snapshotInvoice(invoice);
const attempt: PaymentAttempt = {
  id: "a",
  requestId: "r",
  scope,
  invoice: snapshot,
  operationId: "op",
  requestFingerprint: "fp",
  providerIdempotencyKey: "key",
  actor: { kind: "owner", id: "u" },
  state: "prepared",
  createdAt: 1,
  updatedAt: 1,
};
const event: ProviderEvent = {
  id: "e",
  scope,
  providerEventId: "evt",
  type: "payment",
  payload: "{}",
  receivedAt: 1,
  state: "received",
};
function rawInvoice() {
  return Object.fromEntries(
    Object.entries(invoice).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}
class ScriptedPool implements FinancialPgPool {
  calls: { sql: string; values?: unknown[] }[] = [];
  releases = 0;
  rows: { kind: string; id: string; data: unknown }[] = [];
  invoiceRow = rawInvoice();
  failInsert = false;
  identityOwner?: string;
  async connect(): Promise<FinancialPgClient> {
    return {
      query: async (sql, values) => {
        this.calls.push({ sql, values });
        if (sql.startsWith("SELECT kind,id,data"))
          return {
            rows: structuredClone(this.rows),
            rowCount: this.rows.length,
          };
        if (sql.startsWith("SELECT * FROM invoices"))
          return { rows: [this.invoiceRow], rowCount: 1 };
        if (sql.startsWith("SELECT record_id"))
          return {
            rows: [
              {
                record_id:
                  this.identityOwner ??
                  this.calls.findLast((c) =>
                    c.sql.startsWith("INSERT INTO financial_provider_identity"),
                  )?.values?.[7],
              },
            ],
            rowCount: 1,
          };
        if (sql.startsWith("INSERT INTO financial_records") && this.failInsert)
          throw new Error("database write failed");
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        this.releases += 1;
      },
    };
  }
  store() {
    return new PostgresFinancialStore({ pool: this, workspace: scope });
  }
  load<T extends { id: string }>(kind: string, data: T) {
    this.rows.push({ kind, id: data.id, data });
  }
}
const claim = {
  scope,
  id: "a",
  now: 3,
  lease: { token: "worker", expiresAt: 10 },
  dispatchActor: attempt.actor,
};
const reconciliation = {
  kind: "reconciliation" as const,
  reference: "provider-read",
};

describe("PostgreSQL transaction adapter (scripted SQL, no database proof)", () => {
  it("writes preparation, audit and outbox on one checked-out connection before commit", async () => {
    const p = new ScriptedPool();
    const result = await p
      .store()
      .prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      });
    expect(result.reused).toBe(false);
    const calls = p.calls.map((c) => c.sql);
    expect(calls).toContain("BEGIN");
    expect(calls.at(-1)).toBe("COMMIT");
    expect(
      calls.findIndex((c) => c.includes("pg_advisory_xact_lock")),
    ).toBeLessThan(calls.findIndex((c) => c.startsWith("SELECT kind")));
    const kinds = p.calls
      .filter((c) => c.sql.startsWith("INSERT INTO financial_records"))
      .map((c) => c.values?.[2]);
    expect(kinds).toEqual(
      expect.arrayContaining(["attempts", "operations", "audit", "outbox"]),
    );
    expect(p.releases).toBe(2); // schema client and transaction client
  });
  it("rolls back write failures and always releases the connection", async () => {
    const p = new ScriptedPool();
    p.failInsert = true;
    await expect(
      p
        .store()
        .prepareAttempt({
          scope,
          invoice: snapshot,
          operationId: "op",
          requestFingerprint: "fp",
          actor: attempt.actor,
          now: 3,
        }),
    ).rejects.toThrow("database write failed");
    expect(p.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(p.calls.filter((c) => c.sql === "COMMIT")).toHaveLength(1);
    expect(p.releases).toBe(2);
  });
  it("converts expired dispatch to unknown without claiming redispatch", async () => {
    const p = new ScriptedPool();
    p.load("attempts", {
      ...attempt,
      state: "dispatching",
      lease: { token: "old", expiresAt: 2 },
    });
    expect(await p.store().claimAttemptDispatch(claim)).toBeNull();
    const saved = p.calls.find(
      (c) =>
        c.sql.startsWith("INSERT INTO financial_records") &&
        c.values?.[2] === "attempts",
    );
    expect(JSON.parse(String(saved?.values?.[13])).state).toBe("unknown");
  });
  it("never claims unknown attempts", async () => {
    const p = new ScriptedPool();
    p.load("attempts", { ...attempt, state: "unknown" });
    expect(await p.store().claimAttemptDispatch(claim)).toBeNull();
    expect(
      p.calls.some((c) => c.sql.startsWith("INSERT INTO financial_records")),
    ).toBe(false);
  });
  it("rejects a late dispatch response by lease fence", async () => {
    const p = new ScriptedPool();
    p.load("attempts", {
      ...attempt,
      state: "dispatching",
      lease: { token: "other", expiresAt: 10 },
    });
    await expect(
      p
        .store()
        .recordAttemptDispatch({
          ...claim,
          result: { state: "failed", failure: "error" },
        }),
    ).rejects.toThrow("Stale lease");
    expect(p.calls.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("records scoped event identity before acknowledgement", async () => {
    const p = new ScriptedPool();
    const { event: received } = await p
      .store()
      .receiveProviderEvent({
        scope,
        providerEventId: "evt",
        type: "payment",
        payload: "{}",
        receivedAt: 3,
      });
    expect(received.state).toBe("received");
    const identity = p.calls.find((c) =>
      c.sql.startsWith("INSERT INTO financial_provider_identity"),
    );
    expect(identity?.values?.slice(0, 7)).toEqual([
      "u",
      "u",
      "stripe",
      "acct",
      "test",
      "event",
      "evt",
    ]);
    expect(p.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("commits paid projection, payment, allocation, audit and outbox together", async () => {
    const p = new ScriptedPool();
    p.load("attempts", attempt);
    p.load("events", event);
    const result = await p
      .store()
      .applyPaymentOutcome({
        scope,
        attemptId: "a",
        providerPaymentId: "pi",
        money: snapshot.money,
        confirmedAt: 3,
        source: { kind: "event", eventId: "e" },
      });
    expect(result.reused).toBe(false);
    const kinds = p.calls
      .filter((c) => c.sql.startsWith("INSERT INTO financial_records"))
      .map((c) => c.values?.[2]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "attempts",
        "payments",
        "allocations",
        "audit",
        "outbox",
      ]),
    );
    expect(
      p.calls.some(
        (c) => c.sql.includes("FROM invoices") && c.sql.includes("FOR UPDATE"),
      ),
    ).toBe(true);
    expect(
      p.calls.some(
        (c) =>
          c.sql.startsWith("UPDATE invoices") &&
          c.sql.includes("status='sent'"),
      ),
    ).toBe(true);
    expect(p.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("retains verified payment without projection if current invoice differs", async () => {
    const p = new ScriptedPool();
    p.load("attempts", attempt);
    p.invoiceRow = { ...p.invoiceRow, total: 11 };
    const result = await p
      .store()
      .applyPaymentOutcome({
        scope,
        attemptId: "a",
        providerPaymentId: "pi",
        money: snapshot.money,
        confirmedAt: 3,
        source: reconciliation,
      });
    expect(result.payment.money).toEqual(snapshot.money);
    expect(p.calls.some((c) => c.sql.startsWith("UPDATE invoices"))).toBe(
      false,
    );
    expect(p.calls.at(-1)?.sql).toBe("COMMIT");
    const audit = p.calls.find(
      (c) =>
        c.sql.startsWith("INSERT INTO financial_records") &&
        c.values?.[2] === "audit",
    );
    expect(JSON.parse(String(audit?.values?.[13])).detail.projection).toBe(
      false,
    );
  });
  it("requires a durably received same-scope event", async () => {
    const p = new ScriptedPool();
    p.load("attempts", attempt);
    await expect(
      p
        .store()
        .applyPaymentOutcome({
          scope,
          attemptId: "a",
          providerPaymentId: "pi",
          money: snapshot.money,
          confirmedAt: 3,
          source: { kind: "event", eventId: "missing" },
        }),
    ).rejects.toThrow("not durably received");
  });
  it("rolls back conflicting provider identities", async () => {
    const p = new ScriptedPool();
    p.identityOwner = "some-other-record";
    await expect(
      p
        .store()
        .receiveProviderEvent({
          scope,
          providerEventId: "evt",
          type: "payment",
          payload: "{}",
          receivedAt: 3,
        }),
    ).rejects.toThrow("another financial record");
    expect(p.calls.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("uses SQL indexed bounds for lists and work claims", async () => {
    const p = new ScriptedPool();
    const store = p.store();
    await store.listPayments(scope, { limit: 10 });
    await store.listResumableWork(scope, 3, { limit: 5 });
    await store.claimOutbox(scope, 3, { token: "o", expiresAt: 10 });
    const selects = p.calls.filter((c) => c.sql.startsWith("SELECT kind"));
    expect(selects.every((c) => c.sql.includes("LIMIT"))).toBe(true);
    expect(selects[0].values?.[3]).toBe(11);
    expect(selects[1].values?.at(-1)).toBe(6);
  });
  it("rejects wrong tenant and machine actors without persisted grant proof", async () => {
    const p = new ScriptedPool();
    const store = p.store();
    await expect(
      store.getAttempt({ ...scope, userId: "other" }, "a"),
    ).rejects.toThrow("workspace mismatch");
    await expect(
      store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: { kind: "agent", id: "token" },
        now: 3,
      }),
    ).rejects.toThrow("grant required");
  });
  it("recovers unknown attempt only from a positive provider lookup", async () => {
    const p = new ScriptedPool();
    p.load("attempts", { ...attempt, state: "unknown" });
    const recovered = await p
      .store()
      .reconcileAttempt({
        scope,
        id: "a",
        now: 3,
        result: {
          state: "pending",
          checkoutSessionId: "cs",
          checkoutUrl: "https://checkout.stripe.com/c",
        },
      });
    expect(recovered.state).toBe("pending");
    expect(recovered.checkoutSessionId).toBe("cs");
    expect(p.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("rejects conflicting provider reconciliation and cannot regress confirmed", async () => {
    const p = new ScriptedPool();
    p.load("attempts", {
      ...attempt,
      state: "pending",
      checkoutSessionId: "other",
    });
    await expect(
      p
        .store()
        .reconcileAttempt({
          scope,
          id: "a",
          now: 3,
          result: {
            state: "pending",
            checkoutSessionId: "cs",
            checkoutUrl: "https://checkout.stripe.com/c",
          },
        }),
    ).rejects.toThrow("identity mismatch");
    p.rows = [];
    p.load("attempts", { ...attempt, state: "confirmed" });
    expect(
      (
        await p
          .store()
          .reconcileAttempt({
            scope,
            id: "a",
            now: 3,
            result: {
              state: "pending",
              checkoutSessionId: "cs",
              checkoutUrl: "https://checkout.stripe.com/c",
            },
          })
      ).state,
    ).toBe("confirmed");
  });
  it("requires an actual current dispatcher independently from stored owner attribution",async()=>{
    const p=new ScriptedPool();p.load("attempts",attempt);
    for(const dispatchActor of [{kind:"system" as const,id:"job"},{kind:"owner" as const,id:"foreign"},{kind:"agent" as const,id:"token"}]) {
      await expect(p.store().claimAttemptDispatch({...claim,dispatchActor})).rejects.toThrow();
    }
    expect(p.calls.some(c=>c.sql.startsWith("INSERT INTO financial_records"))).toBe(false);
  });
  it("declares database scoped provider uniqueness and invoice/work indexes", () => {
    expect(FINANCIAL_POSTGRES_SCHEMA.replace(/\s/g, " ")).toContain(
      "PRIMARY KEY(user_id, workspace_id,provider,account_id,mode,kind,object_id)",
    );
    expect(FINANCIAL_POSTGRES_SCHEMA).toContain("financial_invoice_idx");
    expect(FINANCIAL_POSTGRES_SCHEMA).toContain("financial_work_idx");
  });
});

const databaseUrl = process.env.FINANCIAL_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "real PostgreSQL financial transactions (requires disposable FINANCIAL_TEST_DATABASE_URL)",
  () => {
    let pool: import("pg").Pool;
    let admin: import("pg").Pool;
    let schemaName: string;
    let store: PostgresFinancialStore;
    async function reset() {
      await pool.query(
        "TRUNCATE financial_records,financial_provider_identity,invoices,share_links,financial_grants,api_tokens",
      );
      await pool.query(
        "INSERT INTO invoices(id,user_id,client_id,invoice_number,issue_date,due_date,status,line_items,subtotal,total,created_at,updated_at) VALUES('i','u','c','1',1,2,'sent','[]',10,10,1,2)",
      );
    }
    beforeAll(async () => {
      const { Pool } = await import("pg");
      schemaName = `financial_test_${crypto.randomUUID().replaceAll("-", "")}`;
      admin = new Pool({ connectionString: databaseUrl, max: 1 });
      await admin.query(`CREATE SCHEMA ${schemaName}`);
      pool = new Pool({
        connectionString: databaseUrl,
        max: 8,
        options: `-c search_path=${schemaName}`,
      });
      await pool.query(`CREATE TABLE invoices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT,invoice_number TEXT,issue_date BIGINT,due_date BIGINT,status TEXT,line_items JSONB,subtotal DOUBLE PRECISION,total DOUBLE PRECISION,created_at BIGINT,updated_at BIGINT,cloud_link_enabled BOOLEAN);
      CREATE TABLE share_links(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,target JSONB,expires_at BIGINT,revoked_at BIGINT);
      CREATE TABLE api_tokens(id TEXT PRIMARY KEY,user_id TEXT);
      ${FINANCIAL_POSTGRES_SCHEMA}`);
      store = new PostgresFinancialStore({
        pool: pool as unknown as FinancialPgPool,
        workspace: scope,
      });
    });
    beforeEach(reset);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
        await admin.end();
      }
    });
    it("serializes concurrent prepares, leases, duplicate events and payment confirmation", async () => {
      const input = {
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      };
      const prepared = await Promise.all([
        store.prepareAttempt(input),
        store.prepareAttempt({ ...input, operationId: "op2" }),
      ]);
      expect(prepared[0].attempt.id).toBe(prepared[1].attempt.id);
      expect(prepared.filter((x) => !x.reused)).toHaveLength(1);
      const id = prepared[0].attempt.id;
      const claims = await Promise.all([
        store.claimAttemptDispatch({ ...claim, id }),
        store.claimAttemptDispatch({
          ...claim,
          id,
          lease: { token: "other", expiresAt: 10 },
        }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const winner = claims.find(Boolean)!;
      await store.recordAttemptDispatch({
        ...claim,
        id,
        lease: winner.lease!,
        result: {
          state: "pending",
          checkoutSessionId: "cs",
          checkoutUrl: "https://checkout.stripe.com/c",
          providerPaymentId: "pi",
        },
      });
      const events = await Promise.all([
        store.receiveProviderEvent({
          scope,
          providerEventId: "evt",
          type: "payment",
          payload: "{}",
          receivedAt: 3,
        }),
        store.receiveProviderEvent({
          scope,
          providerEventId: "evt",
          type: "payment",
          payload: "{}",
          receivedAt: 3,
        }),
      ]);
      expect(events.filter((x) => !x.reused)).toHaveLength(1);
      const outcome = {
        scope,
        attemptId: id,
        providerPaymentId: "pi",
        money: snapshot.money,
        confirmedAt: 4,
        source: { kind: "event" as const, eventId: events[0].event.id },
      };
      const confirmations = await Promise.all([
        store.applyPaymentOutcome(outcome),
        store.applyPaymentOutcome(outcome),
      ]);
      expect(confirmations.filter((x) => !x.reused)).toHaveLength(1);
      expect(
        (await pool.query("SELECT status FROM invoices WHERE id='i'")).rows[0]
          .status,
      ).toBe("paid");
      const counts = (
        await pool.query(
          "SELECT kind,count(*)::integer AS count FROM financial_records GROUP BY kind",
        )
      ).rows;
      expect(counts.find((x) => x.kind === "payments")?.count).toBe(1);
      expect(counts.find((x) => x.kind === "allocations")?.count).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_records WHERE kind='audit' AND data->>'kind'='payment.confirmed'",
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_records WHERE kind='outbox' AND data->>'topic'='payment.confirmed'",
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("processes genuine durable checkout and refund receipts through financial-events", async () => {
      const { attempt: a } = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      });
      await store.claimAttemptDispatch({ ...claim, id: a.id });
      await store.recordAttemptDispatch({
        ...claim,
        id: a.id,
        result: {
          state: "pending",
          checkoutSessionId: "cs",
          checkoutUrl: "https://checkout.stripe.com/c",
        },
      });
      const received = await receiveStripeEvent(store, scope, {
        id: "evt_checkout",
        type: "checkout.session.completed",
        account: "acct",
        livemode: false,
        data: {
          object: {
            id: "cs",
            livemode: false,
            payment_status: "paid",
            amount_total: 1000,
            currency: "usd",
            payment_intent: "pi",
            metadata: {
              attemptId: a.id,
              invoiceId: "i",
              accountId: "acct",
              invoiceFingerprint: createHash("sha256")
                .update(snapshot.fingerprint)
                .digest("hex"),
            },
          },
        },
      });
      await processFinancialEvent(store, received.event);
      expect((await store.getAttempt(scope, a.id))?.state).toBe("confirmed");
      expect(
        (
          await pool.query(
            "SELECT status FROM financial_records WHERE kind='events' AND id=$1",
            [received.event.id],
          )
        ).rows[0].status,
      ).toBe("processed");
      const refund = await receiveStripeEvent(store, scope, {
        id: "evt_refund",
        type: "refund.created",
        account: "acct",
        livemode: false,
        data: {
          object: {
            id: "re",
            payment_intent: "pi",
            amount: 500,
            currency: "usd",
            status: "succeeded",
          },
        },
      });
      await processFinancialEvent(store, refund.event);
      const timeline = await store.getInvoiceTimeline(scope, "i", {
        limit: 100,
      });
      expect(timeline.payments).toHaveLength(1);
      expect(timeline.refunds).toHaveLength(1);
      expect(timeline.refunds[0]).toMatchObject({
        state: "confirmed",
        money: { minorUnits: 500, currency: "USD" },
      });
      expect(
        (
          await pool.query(
            "SELECT status FROM financial_records WHERE kind='events' AND id=$1",
            [refund.event.id],
          )
        ).rows[0].status,
      ).toBe("processed");
    });
    it("records stale invoice money without projection and rolls back all records on outbox failure", async () => {
      const { attempt: a } = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      });
      let input = {
        scope,
        attemptId: a.id,
        providerPaymentId: "pi",
        money: snapshot.money,
        confirmedAt: 4,
        source: reconciliation,
      };
      await pool.query("UPDATE invoices SET total=11 WHERE id='i'");
      await store.applyPaymentOutcome(input);
      expect(
        (await pool.query("SELECT status,total FROM invoices WHERE id='i'"))
          .rows[0],
      ).toEqual({ status: "sent", total: 11 });
      expect(
        (
          await pool.query(
            "SELECT data->'detail'->>'projection' AS projection FROM financial_records WHERE kind='audit' AND data->>'kind'='payment.confirmed'",
          )
        ).rows[0].projection,
      ).toBe("false");
      await reset();
      const fresh = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "fresh",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      });
      input = { ...input, attemptId: fresh.attempt.id };
      await pool.query(`CREATE FUNCTION reject_confirmed_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='outbox' AND NEW.data->>'topic'='payment.confirmed' THEN RAISE EXCEPTION 'injected outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_outbox BEFORE INSERT OR UPDATE ON financial_records FOR EACH ROW EXECUTE FUNCTION reject_confirmed_outbox();`);
      try {
        await expect(store.applyPaymentOutcome(input)).rejects.toThrow(
          "injected outbox failure",
        );
      } finally {
        await pool.query(
          "DROP TRIGGER fail_outbox ON financial_records; DROP FUNCTION reject_confirmed_outbox()",
        );
      }
      expect(
        (await pool.query("SELECT status FROM invoices WHERE id='i'")).rows[0]
          .status,
      ).toBe("sent");
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_records WHERE kind IN ('payments','allocations')",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_provider_identity WHERE kind='payment'",
          )
        ).rows[0].count,
      ).toBe(0);
      expect((await store.getAttempt(scope, input.attemptId))?.state).toBe(
        "prepared",
      );
    });
    it("cannot dispatch a prepared checkout after the invoice changes", async () => {
      const { attempt: a } = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      });
      await pool.query(
        "UPDATE invoices SET status='draft',updated_at=4 WHERE id='i'",
      );
      await expect(
        store.claimAttemptDispatch({ ...claim, id: a.id }),
      ).rejects.toThrow("not currently sent");
      expect((await store.getAttempt(scope, a.id))?.state).toBe("prepared");
    });
    it("supersedes only stale undispatched intent and preserves old operation identity",async()=>{
      const old=await store.prepareAttempt({scope,invoice:snapshot,operationId:"old",requestFingerprint:"fp",actor:attempt.actor,now:3});
      await pool.query("UPDATE invoices SET total=11,subtotal=11,updated_at=4 WHERE id='i'");
      const current=snapshotInvoice({...invoice,total:11,subtotal:11,updatedAt:4});
      await expect(store.prepareAttempt({scope,invoice:current,operationId:"old",requestFingerprint:"newfp",actor:attempt.actor,now:5})).rejects.toThrow("fingerprint conflict");
      const fresh=await store.prepareAttempt({scope,invoice:current,operationId:"fresh",requestFingerprint:"newfp",actor:attempt.actor,now:5});
      expect(fresh.attempt.id).not.toBe(old.attempt.id);expect((await store.getAttempt(scope,old.attempt.id))?.state).toBe("failed");
      await store.claimAttemptDispatch({...claim,id:fresh.attempt.id,now:6});
      await pool.query("UPDATE invoices SET total=12,subtotal=12,updated_at=7 WHERE id='i'");
      await expect(store.prepareAttempt({scope,invoice:snapshotInvoice({...invoice,total:12,subtotal:12,updatedAt:7}),operationId:"third",requestFingerprint:"thirdfp",actor:attempt.actor,now:8})).rejects.toThrow("Outstanding payable attempt");
      expect((await store.getAttempt(scope,fresh.attempt.id))?.state).toBe("dispatching");
    });
    it("reconciles expired provider session terminally and permits a new intent",async()=>{
      const old=await store.prepareAttempt({scope,invoice:snapshot,operationId:"old",requestFingerprint:"fp",actor:attempt.actor,now:3});
      await store.claimAttemptDispatch({...claim,id:old.attempt.id});
      await store.recordAttemptDispatch({...claim,id:old.attempt.id,result:{state:"pending",checkoutSessionId:"cs",checkoutUrl:"https://checkout.stripe.com/c"}});
      const failure={state:"failed" as const,failure:"Provider session expired",checkoutSessionId:"cs"};
      expect((await store.reconcileAttempt({scope,id:old.attempt.id,now:4,result:failure})).state).toBe("failed");
      expect((await store.reconcileAttempt({scope,id:old.attempt.id,now:5,result:failure})).state).toBe("failed");
      await expect(store.reconcileAttempt({scope,id:old.attempt.id,now:5,result:{...failure,checkoutSessionId:"other"}})).rejects.toThrow("identity mismatch");
      const fresh=await store.prepareAttempt({scope,invoice:snapshot,operationId:"fresh",requestFingerprint:"fp",actor:attempt.actor,now:5});
      expect(fresh.attempt.id).not.toBe(old.attempt.id);expect(fresh.attempt.state).toBe("prepared");
    });
    it("cannot prepare another payable attempt after account or mode switch", async () => {
      const input = {
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
      };
      const payable=await store.prepareAttempt(input);
      await store.claimAttemptDispatch({...claim,id:payable.attempt.id});
      await store.recordAttemptDispatch({...claim,id:payable.attempt.id,result:{state:"pending",checkoutSessionId:"cs",checkoutUrl:"https://checkout.stripe.com/c"}});
      await expect(
        store.prepareAttempt({
          ...input,
          scope: { ...scope, accountId: "another" },
          operationId: "op2",
        }),
      ).rejects.toThrow("scope mismatch");
      await expect(
        store.prepareAttempt({
          ...input,
          scope: { ...scope, mode: "live" },
          operationId: "op3",
        }),
      ).rejects.toThrow("scope mismatch");
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_records WHERE kind='attempts'",
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("enforces real provider uniqueness with independent account/mode identities", async () => {
      for (const s of [
        scope,
        { ...scope, mode: "live" as const },
        { ...scope, accountId: "another" },
      ])
        await store.receiveProviderEvent({
          scope: s,
          providerEventId: "evt",
          type: "payment",
          payload: "{}",
          receivedAt: 3,
        });
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM financial_provider_identity WHERE kind='event'",
          )
        ).rows[0].count,
      ).toBe(3);
      await expect(
        pool.query(
          "INSERT INTO financial_provider_identity VALUES('u','u','stripe','acct','test','event','evt','conflict')",
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
    it("checks current machine dispatcher despite owner preparation and rejects revoked grant/deleted token", async () => {
      const grant = {
        id: "g",
        userId: "u",
        workspaceId: "u",
        principal: { kind: "api-token" as const, tokenId: "token" },
        actions: ["collect"],
        accountId: "acct",
        mode: "test",
        currency: "USD",
        maxMinorUnits: 1000,
        createdAt: 1,
        revokedAt: null,
      };
      const proof = {
        grantId: "g",
        principal: grant.principal,
        action: "collect" as const,
        scope,
        money: snapshot.money,
        invoiceId: "i",
        grantedAt: 1,
      };
      await pool.query(
        "INSERT INTO financial_grants VALUES('g','u','u',$1,NULL)",
        [JSON.stringify(grant)],
      );
      await pool.query("INSERT INTO api_tokens VALUES('token','u')");
      const { attempt: a } = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: attempt.actor,
        now: 3,
        authorityProof: proof,
      });
      await pool.query("UPDATE financial_grants SET revoked_at=4 WHERE id='g'");
      await expect(
        store.claimAttemptDispatch({
          ...claim,
          id: a.id,
          authorityProof: proof,
          dispatchActor:{kind:"agent",id:"token"},
        }),
      ).rejects.toThrow("authority denied");
      await pool.query(
        "UPDATE financial_grants SET revoked_at=NULL WHERE id='g'; DELETE FROM api_tokens WHERE id='token'",
      );
      await expect(
        store.claimAttemptDispatch({
          ...claim,
          id: a.id,
          authorityProof: proof,
          dispatchActor:{kind:"agent",id:"token"},
        }),
      ).rejects.toThrow("token no longer active");
      expect((await store.getAttempt(scope, a.id))?.state).toBe("prepared");
    });
    it("locks and rechecks customer capability revocation before dispatch", async () => {
      const proof = {
        kind: "customer" as const,
        linkId: "link",
        userId: "u",
        workspaceId: "u",
        invoiceId: "i",
        expiresAt: 100,
      };
      await pool.query(
        "INSERT INTO share_links VALUES('link','u','invoice','{\"invoiceId\":\"i\"}',100,NULL)",
      );
      const { attempt: a } = await store.prepareAttempt({
        scope,
        invoice: snapshot,
        operationId: "op",
        requestFingerprint: "fp",
        actor: { kind: "customer", id: "link" },
        now: 3,
        capabilityProof: proof,
      });
      await pool.query("UPDATE share_links SET revoked_at=4 WHERE id='link'");
      await expect(
        store.claimAttemptDispatch({
          ...claim,
          id: a.id,
          capabilityProof: proof,
          dispatchActor:{kind:"customer",id:"link"},
        }),
      ).rejects.toThrow("capability denied");
      expect((await store.getAttempt(scope, a.id))?.state).toBe("prepared");
    });
  },
);
