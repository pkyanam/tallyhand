/**
 * Per-user isolation tests for ConvexStorageProvider.
 *
 * The Convex client is faked with a recorder: every query/mutation call's
 * function path and args are captured. The suite proves that every call —
 * reads, writes, deletes, and the atomic workflow mutations — carries the
 * owner's `userId` in its args, and that two providers never leak each
 * other's ids. The single exception (asserted separately) is
 * `getShareLinkById`, the public share-token capability lookup that runs
 * after HMAC verification.
 */
import { describe, expect, it } from "vitest";
import {
  cleanArgs,
  ConvexStorageProvider,
  type ConvexClientLike,
} from "@/lib/db/convex-provider";
import type { Invoice } from "@/core/entities";

const USER_A = "user_aaaaaaaaaaaaaaaa";
const USER_B = "user_bbbbbbbbbbbbbbbb";

interface CallRecord {
  kind: "query" | "mutation";
  path: string;
  args: Record<string, unknown>;
}

function createRecordingClient(): { client: ConvexClientLike; record: CallRecord[] } {
  const record: CallRecord[] = [];
  const client: ConvexClientLike = {
    async query(path, args) {
      record.push({ kind: "query", path, args });
      return [];
    },
    async mutation(path, args) {
      record.push({ kind: "mutation", path, args });
      if (path === "tally:assignInvoiceNumber") return "INV-1001";
      if (path === "tally:settingsGet") return {};
      if (path === "tally:settingsUpdate") return {};
      return { id: "doc_1", userId: args.userId };
    },
  };
  return { client, record };
}

function providerFor(uid: string) {
  const { client, record } = createRecordingClient();
  return { provider: new ConvexStorageProvider(client, uid), record };
}

const MIN_INVOICE = {
  id: "inv_1",
  lineItems: [
    { sourceType: "task", sourceId: "t1" },
    { sourceType: "expense", sourceId: "e1" },
  ],
} as unknown as Invoice;

describe("ConvexStorageProvider per-user isolation", () => {
  it("passes the owner's userId on every call", async () => {
    const { provider, record } = providerFor(USER_A);

    await provider.listClients();
    await provider.getClient("c1");
    await provider.createClient({ name: "Acme" });
    await provider.updateClient("c1", { name: "X" });
    await provider.removeClient("c1");

    await provider.listProjects();
    await provider.listProjectsByClient("c1");
    await provider.getProject("p1");
    await provider.createProject({ clientId: "c1", name: "P" });
    await provider.updateProject("p1", { name: "X" });
    await provider.removeProject("p1");

    await provider.listTasks();
    await provider.getTask("t1");
    await provider.listTasksByProject("p1");
    await provider.listUnbilledTasks();
    await provider.createTask({ projectId: "p1", name: "T", startAt: 1, endAt: 61_000 });
    await provider.updateTask("t1", { name: "X" });
    await provider.removeTask("t1");

    await provider.listExpenses();
    await provider.getExpense("e1");
    await provider.createExpense({ date: 1, amount: 9.5, category: "Meals" });
    await provider.updateExpense("e1", { note: "X" });
    await provider.removeExpense("e1");

    await provider.listInvoices();
    await provider.getInvoice("i1");
    await provider.getInvoiceByPublicToken("tok");
    await provider.createInvoice({
      clientId: "c1", invoiceNumber: "INV-1", issueDate: 1, dueDate: 2,
      status: "draft", lineItems: [], subtotal: 0, total: 0,
    });
    await provider.updateInvoice("i1", { notes: "X" });
    await provider.removeInvoice("i1");

    await provider.readSettings();
    await provider.getSettings();
    await provider.updateSettings({ business: { name: "X" } });

    await provider.listRecurringSchedules();
    await provider.listRecurringSchedules("active");
    await provider.listRecurringSchedulesByClient("c1");
    await provider.getRecurringSchedule("r1");
    await provider.createRecurringSchedule({
      clientId: "c1", name: "R", mode: "fixed", frequency: "monthly",
      interval: 1, lineItems: [], startDate: 1,
    });
    await provider.updateRecurringSchedule("r1", { name: "X" });
    await provider.removeRecurringSchedule("r1");

    await provider.listRetainers();
    await provider.listRetainers("active");
    await provider.listRetainersByClient("c1");
    await provider.getRetainer("r1");
    await provider.createRetainer({
      clientId: "c1", name: "Ret", type: "monthly-fee", amountCents: 1000, startDate: 1,
    });
    await provider.updateRetainer("r1", { name: "X" });
    await provider.removeRetainer("r1");

    await provider.assignNextInvoiceNumber();
    await provider.markInvoiceSent(MIN_INVOICE);
    await provider.markInvoicePaid("i1");

    await provider.createShareLink({ type: "invoice", target: { invoiceId: "i1" }, expiresAt: 999 });
    await provider.listShareLinks();
    await provider.revokeShareLink("shl_1");
    await provider.recordTimesheetApproval({ shareLinkId: "shl_1", clientId: "c1", weekStartMs: 1 });
    await provider.listTimesheetApprovalsByLink("shl_1");

    expect(record.length).toBeGreaterThan(40);
    for (const call of record) {
      expect(call.path.startsWith("tally:"), `unexpected path ${call.path}`).toBe(true);
      expect(call.args.userId, `${call.path} missing userId`).toBe(USER_A);
    }
  });

  it("never leaks one user's id into another user's calls", async () => {
    const a = providerFor(USER_A);
    const b = providerFor(USER_B);
    await a.provider.listTasks();
    await a.provider.getClient("shared");
    await b.provider.listTasks();
    await b.provider.removeInvoice("shared");

    for (const call of a.record) {
      expect(call.args.userId).toBe(USER_A);
      expect(JSON.stringify(call.args)).not.toContain(USER_B);
    }
    for (const call of b.record) {
      expect(call.args.userId).toBe(USER_B);
      expect(JSON.stringify(call.args)).not.toContain(USER_A);
    }
  });

  it("supports a lazy async user-id resolver", async () => {
    const { client, record } = createRecordingClient();
    const provider = new ConvexStorageProvider(client, async () => USER_B);
    await provider.listClients();
    expect(record[0].args.userId).toBe(USER_B);
  });

  it("documents the single user-less call: share-token capability lookup", async () => {
    const { provider, record } = providerFor(USER_A);
    await provider.getShareLinkById("shl_abc");
    expect(record).toHaveLength(1);
    expect(record[0].path).toBe("tally:shareGetById");
    // No userId — runs only after HMAC signature verification.
    expect("userId" in record[0].args).toBe(false);
  });
});

describe("cleanArgs", () => {
  it("strips undefined (Convex rejects undefined in args)", () => {
    expect(cleanArgs({ a: 1, b: undefined, c: { d: undefined, e: "x" } })).toEqual({
      a: 1,
      c: { e: "x" },
    });
    expect(cleanArgs({ tags: ["a", undefined] })).toEqual({ tags: ["a", undefined] });
  });
});
