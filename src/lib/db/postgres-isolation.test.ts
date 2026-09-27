/**
 * Per-user isolation tests for PostgresStorageProvider.
 *
 * The provider's drizzle-orm condition builders (`eq`/`and`/`desc`) and the
 * drizzle db are injected as fakes: `fakeOps` tags every predicate with a
 * marker object, and the recording db captures every chained call. The suite
 * then proves, for every public method, that:
 *
 * 1. every SELECT/UPDATE/DELETE carries a WHERE clause mentioning the
 *    owner's userId (no unscoped reads/writes/deletes);
 * 2. every INSERT writes `userId` = the owner's id;
 * 3. the atomic workflows run inside a transaction and stay scoped;
 * 4. two providers for different users never mention each other's id —
 *    cross-user leakage is structurally impossible.
 *
 * The only intentionally unscoped read is `getShareLinkById` (the public
 * share-token capability lookup, which runs after HMAC verification); it is
 * asserted separately and documented in the provider.
 */
import { describe, expect, it, vi } from "vitest";

// The real schema module imports drizzle-orm/pg-core, which is not installed
// until the coordinator runs npm install. The provider only needs table
// *identity* (which column of which table a predicate references), so mock
// every table as a column-name proxy — enough to verify scoping.
vi.mock("@/lib/db/postgres-schema", () => {
  const table = () =>
    new Proxy(
      {},
      { get: (_t, prop) => `col:${String(prop)}` },
    );
  return {
    clients: table(),
    projects: table(),
    tasks: table(),
    expenses: table(),
    invoices: table(),
    recurringSchedules: table(),
    retainers: table(),
    settings: table(),
    shareLinks: table(),
    timesheetApprovals: table(),
    encryptedEntities: table(),
  };
});

import {
  PostgresStorageProvider,
  type ConditionOps,
  type DbLike,
} from "@/lib/db/postgres-provider";
import type { Invoice } from "@/core/entities";

const USER_A = "user_aaaaaaaaaaaaaaaa";
const USER_B = "user_bbbbbbbbbbbbbbbb";

/** Fake condition builders: tag predicates so tests can inspect them. */
const fakeOps: ConditionOps = {
  eq: (column, value) => ({ __eq: [column, value] }),
  and: (...conds) => ({ __and: conds }),
  or: (...conds) => ({ __or: conds }),
  desc: (column) => ({ __desc: column }),
  gt: (column, value) => ({ __gt: [column, value] }),
};

interface CallRecord {
  chain: string[];
  args: unknown[][];
}

/** Recording stand-in for the drizzle db: every chainable call is captured. */
function createRecordingDb(cannedRows: unknown[] = [{}]) {
  const record: CallRecord[] = [];
  function chainable(chain: string[], args: unknown[][]): unknown {
    return new Proxy(function () {}, {
      get(_t, prop: string | symbol) {
        if (prop === "then") {
          // Awaiting a chain resolves canned rows and records the call.
          return (resolve: (v: unknown) => void) => {
            record.push({ chain, args });
            resolve(cannedRows);
          };
        }
        if (prop === "transaction") {
          return async (cb: (tx: unknown) => Promise<unknown>) => {
            record.push({ chain: [...chain, "transaction"], args });
            // Append an empty args entry so args[i] stays aligned with chain[i].
            return cb(chainable([...chain, "transaction"], [...args, []]));
          };
        }
        return (...callArgs: unknown[]) =>
          chainable([...chain, String(prop)], [...args, callArgs]);
      },
      apply() {
        record.push({ chain, args });
        return Promise.resolve([{}]);
      },
    });
  }
  return { db: chainable([], []) as unknown as DbLike, record };
}

function providerFor(uid: string) {
  const { db, record } = createRecordingDb();
  return {
    provider: new PostgresStorageProvider(db, uid, fakeOps),
    record,
  };
}

/** Does a (possibly nested) fake condition mention this user id? */
function mentionsUserId(cond: unknown, uid: string): boolean {
  if (cond === uid) return true;
  if (!cond || typeof cond !== "object") return false;
  return Object.values(cond as Record<string, unknown>).some((v) =>
    mentionsUserId(v, uid),
  );
}

/** WHERE conditions from every recorded call that has one. */
function whereConditions(record: CallRecord[]): unknown[] {
  const conds: unknown[] = [];
  for (const call of record) {
    const idx = call.chain.indexOf("where");
    if (idx >= 0) conds.push(call.args[idx][0]);
  }
  return conds;
}

/** Assert every recorded SELECT/UPDATE/DELETE has a WHERE naming `uid`. */
function expectAllScoped(record: CallRecord[], uid: string, label: string) {
  const scopedOps = record.filter((c) =>
    ["select", "update", "delete"].includes(c.chain[0]),
  );
  expect(scopedOps.length).toBeGreaterThan(0);
  for (const call of scopedOps) {
    const idx = call.chain.indexOf("where");
    expect(
      idx >= 0,
      `${label}: ${call.chain.join(".")} has no WHERE clause`,
    ).toBe(true);
    expect(
      mentionsUserId(call.args[idx][0], uid),
      `${label}: ${call.chain.join(".")} WHERE does not mention userId`,
    ).toBe(true);
  }
}

/** Assert every recorded INSERT writes userId = uid. */
function expectAllInsertsOwned(record: CallRecord[], uid: string, label: string) {
  const inserts = record.filter((c) => c.chain[0] === "insert");
  expect(inserts.length).toBeGreaterThan(0);
  for (const call of inserts) {
    const idx = call.chain.indexOf("values");
    expect(idx >= 0, `${label}: insert has no values()`).toBe(true);
    const values = call.args[idx][0] as Record<string, unknown>;
    expect(values.userId, `${label}: insert missing userId`).toBe(uid);
  }
}

const MIN_INVOICE = {
  id: "inv_1",
  lineItems: [
    { sourceType: "task", sourceId: "t1" },
    { sourceType: "expense", sourceId: "e1" },
    { sourceType: "manual" },
  ],
} as unknown as Invoice;

describe("PostgresStorageProvider per-user isolation", () => {
  it("scopes every read by userId", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.listClients();
    await provider.listClients(true);
    await provider.getClient("c1");
    await provider.listProjects();
    await provider.listProjectsByClient("c1");
    await provider.getProject("p1");
    await provider.listTasks();
    await provider.getTask("t1");
    await provider.listTasksByProject("p1");
    await provider.listUnbilledTasks();
    await provider.listExpenses();
    await provider.getExpense("e1");
    await provider.listInvoices();
    await provider.getInvoice("i1");
    await provider.getInvoiceByPublicToken("tok");
    await provider.readSettings();
    await provider.getSettings();
    await provider.listRecurringSchedules();
    await provider.listRecurringSchedules("active");
    await provider.listRecurringSchedulesByClient("c1");
    await provider.getRecurringSchedule("r1");
    await provider.listRetainers();
    await provider.listRetainers("active");
    await provider.listRetainersByClient("c1");
    await provider.getRetainer("r1");
    await provider.listShareLinks();
    await provider.listTimesheetApprovalsByLink("shl_1");
    await provider.countEncryptedEntities();
    expectAllScoped(record, USER_A, "reads");
  });

  it("tags every insert with the owner's userId", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.createClient({ name: "Acme" });
    await provider.createProject({ clientId: "c1", name: "P" });
    await provider.createTask({
      projectId: "p1",
      name: "T",
      startAt: 1,
      endAt: 61_000,
    });
    await provider.createExpense({ date: 1, amount: 9.5, category: "Meals" });
    await provider.createInvoice({
      clientId: "c1",
      invoiceNumber: "INV-1",
      issueDate: 1,
      dueDate: 2,
      status: "draft",
      lineItems: [],
      subtotal: 0,
      total: 0,
    });
    await provider.createRecurringSchedule({
      clientId: "c1",
      name: "R",
      mode: "fixed",
      frequency: "monthly",
      interval: 1,
      lineItems: [],
      startDate: 1,
    });
    await provider.createRetainer({
      clientId: "c1",
      name: "Ret",
      type: "monthly-fee",
      amountCents: 1000,
      startDate: 1,
    });
    await provider.createShareLink({
      type: "invoice",
      target: { invoiceId: "i1" },
      expiresAt: 999,
    });
    await provider.recordTimesheetApproval({
      shareLinkId: "shl_1",
      clientId: "c1",
      weekStartMs: 1,
    });
    await provider.upsertEncryptedEntities([
      {
        entityType: "task",
        entityId: "t1",
        iv: "aXY=",
        ciphertext: "c2VjcmV0",
        updatedAt: 42,
        deleted: false,
      },
      // Malformed payloads are dropped, never written.
      { entityType: "nope", entityId: "x" } as never,
    ]);
    expectAllInsertsOwned(record, USER_A, "creates");
  });

  it("scopes every update and delete by userId", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.updateClient("c1", { name: "X" });
    await provider.removeClient("c1");
    await provider.updateProject("p1", { name: "X" });
    await provider.removeProject("p1");
    await provider.updateTask("t1", { name: "X" });
    await provider.updateTask("t1", { startAt: 5 });
    await provider.removeTask("t1");
    await provider.updateExpense("e1", { note: "X" });
    await provider.removeExpense("e1");
    await provider.updateInvoice("i1", { notes: "X" });
    await provider.removeInvoice("i1");
    await provider.markInvoicePaid("i1");
    await provider.updateSettings({ business: { name: "X" } });
    await provider.updateRecurringSchedule("r1", { name: "X" });
    await provider.removeRecurringSchedule("r1");
    await provider.updateRetainer("r1", { name: "X" });
    await provider.removeRetainer("r1");
    await provider.revokeShareLink("shl_1");
    expectAllScoped(record, USER_A, "updates/deletes");
  });

  it("runs atomic workflows inside a transaction, still scoped", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.markInvoiceSent(MIN_INVOICE);
    await provider.assignNextInvoiceNumber();

    const txns = record.filter(
      (c) => c.chain.length === 1 && c.chain[0] === "transaction",
    );
    expect(txns.length).toBe(2);

    // Every nested statement inside the transactions stays user-scoped.
    const nested = record.filter(
      (c) => c.chain[0] === "transaction" && c.chain.length > 1,
    );
    expect(nested.length).toBeGreaterThan(0);
    for (const call of nested) {
      const idx = call.chain.indexOf("where");
      if (idx >= 0) {
        expect(mentionsUserId(call.args[idx][0], USER_A)).toBe(true);
      }
    }
    // markInvoiceSent touched invoice + its task + its expense (3 updates);
    // assignNextInvoiceNumber's settings upsert adds a 4th.
    const updatedTables = record
      .filter((c) => c.chain.includes("update"))
      .map((c) => c.args[c.chain.indexOf("update")][0]);
    expect(updatedTables.length).toBe(4);
  });

  it("scopes the encrypted sync vault by userId", async () => {
    const syncRow = {
      userId: USER_A,
      entityType: "task",
      entityId: "t1",
      iv: "aXY=",
      ciphertext: "c2VjcmV0",
      updatedAt: 7,
      deleted: false,
    };
    const { db, record } = createRecordingDb([syncRow]);
    const provider = new PostgresStorageProvider(db, USER_A, fakeOps);

    const pulled = await provider.listEncryptedEntitiesSince(0);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]?.entityId).toBe("t1");
    const filtered = await provider.listEncryptedEntitiesSince(0, ["invoice"]);
    expect(filtered).toHaveLength(0);
    // Stale push is dropped by last-write-wins before any insert runs.
    const stale = await provider.upsertEncryptedEntities([
      {
        entityType: "task",
        entityId: "t1",
        iv: "aXY=",
        ciphertext: "bmV3",
        updatedAt: 6,
        deleted: false,
      },
    ]);
    expect(stale).toBe(0);

    expectAllScoped(record, USER_A, "sync reads");
    const inserts = record.filter((c) => c.chain[0] === "insert");
    expect(inserts).toHaveLength(0); // nothing newer to write
  });

  it("never leaks one user's id into another user's queries", async () => {
    const a = providerFor(USER_A);
    const b = providerFor(USER_B);
    await a.provider.getClient("shared-id");
    await a.provider.listTasks();
    await b.provider.getClient("shared-id");
    await b.provider.listTasks();
    await b.provider.removeInvoice("shared-id");

    for (const cond of whereConditions(a.record)) {
      expect(mentionsUserId(cond, USER_A)).toBe(true);
      expect(mentionsUserId(cond, USER_B)).toBe(false);
    }
    for (const cond of whereConditions(b.record)) {
      expect(mentionsUserId(cond, USER_B)).toBe(true);
      expect(mentionsUserId(cond, USER_A)).toBe(false);
    }
  });

  it("supports a lazy async user-id resolver", async () => {
    const { db, record } = createRecordingDb();
    const provider = new PostgresStorageProvider(
      db,
      async () => USER_B,
      fakeOps,
    );
    await provider.listClients();
    expectAllScoped(record, USER_B, "lazy-resolver");
  });

  it("documents the single unscoped read: share-token capability lookup", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.getShareLinkById("shl_abc");
    const selects = record.filter((c) => c.chain[0] === "select");
    expect(selects.length).toBe(1);
    const conds = whereConditions(record);
    expect(conds.length).toBe(1);
    // The capability lookup is by link id only — no userId predicate — and
    // is only ever called after HMAC signature verification.
    expect(mentionsUserId(conds[0], USER_A)).toBe(false);
  });
});
