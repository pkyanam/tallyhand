/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../convex/schema";
const modules = import.meta.glob("../../convex/**/*.{ts,js}");
const secret = "maintenance-test-server-secret-1234567890";
const query = makeFunctionReference<"query">("financialMaintenance:discover");
const claim = makeFunctionReference<"mutation">("financialMaintenance:claim");
const finish = makeFunctionReference<"mutation">("financialMaintenance:finish");
beforeEach(() => vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", secret));
afterEach(() => vi.unstubAllEnvs());
describe("Convex maintenance boundary", () => {
  it("rejects direct unauthenticated discovery and checkpoint claims", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(query, { limit: 10, serverSecret: "wrong" }),
    ).rejects.toThrow("Server authorization required");
    await expect(
      t.mutation(claim, {
        id: "job",
        now: 1,
        lease: { token: "t", expiresAt: 100 },
        serverSecret: "wrong",
      }),
    ).rejects.toThrow("Server authorization required");
  });
  it("durably fences overlapping runs and resumes saved pagination", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.mutation(claim, {
        id: "job",
        now: 1,
        lease: { token: "one", expiresAt: 100 },
        serverSecret: secret,
      }),
    ).toEqual({});
    expect(
      await t.mutation(claim, {
        id: "job",
        now: 2,
        lease: { token: "two", expiresAt: 100 },
        serverSecret: secret,
      }),
    ).toBeNull();
    await expect(
      t.mutation(finish, {
        id: "job",
        leaseToken: "two",
        now: 3,
        progress: { scopes: {} },
        serverSecret: secret,
      }),
    ).rejects.toThrow("Recovery lease stale");
    await t.mutation(finish, {
      id: "job",
      leaseToken: "one",
      now: 4,
      progress: { scopeCursor: "page2", scopes: {} },
      serverSecret: secret,
    });
    expect(
      await t.mutation(claim, {
        id: "job",
        now: 5,
        lease: { token: "three", expiresAt: 100 },
        serverSecret: secret,
      }),
    ).toEqual({ scopeCursor: "page2", scopes: {} });
  });
  it("discovers scoped records in bounded pages without workspace ledger loads", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const id of ["a", "b", "c"])
        await ctx.db.insert("financialRecords", {
          userId: id,
          workspaceId: id,
          scopeKey: id,
          kind: "payment",
          id,
          uniqueKey: id,
          invoiceId: "i",
          state: "confirmed",
          availableAt: 0,
          createdAt: 1,
          data: {
            scope: {
              userId: id,
              workspaceId: id,
              provider: "stripe",
              accountId: `acct_${id}`,
              mode: "test",
            },
          },
        });
    });
    const first = await t.query(query, { limit: 2, serverSecret: secret });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await t.query(query, {
      limit: 2,
      cursor: first.nextCursor,
      serverSecret: secret,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });
  it("fences per-scope progress independently of the discovery cursor", async () => {
    const t = convexTest(schema, modules);
    const id = `scope:${"a".repeat(64)}`;
    const read = makeFunctionReference<"query">(
      "financialMaintenance:scopeProgress",
    );
    const save = makeFunctionReference<"mutation">(
      "financialMaintenance:saveScopeProgress",
    );
    await t.mutation(claim, {
      id: "job",
      now: 1,
      lease: { token: "run", expiresAt: 100 },
      serverSecret: secret,
    });
    await t.mutation(save, {
      id,
      runId: "job",
      leaseToken: "run",
      now: 2,
      progress: { paymentCursor: "page2" },
      serverSecret: secret,
    });
    await expect(
      t.mutation(save, {
        id,
        runId: "job",
        leaseToken: "wrong",
        now: 3,
        progress: null,
        serverSecret: secret,
      }),
    ).rejects.toThrow("Recovery lease stale");
    await t.mutation(finish, {
      id: "job",
      leaseToken: "run",
      now: 4,
      progress: { scopeCursor: "globalpage2", scopes: {} },
      serverSecret: secret,
    });
    expect(await t.query(read, { id, serverSecret: secret })).toEqual({
      paymentCursor: "page2",
    });
    await t.mutation(claim, {
      id: "job",
      now: 5,
      lease: { token: "second", expiresAt: 100 },
      serverSecret: secret,
    });
    await t.mutation(save, {
      id,
      runId: "job",
      leaseToken: "second",
      now: 6,
      progress: null,
      serverSecret: secret,
    });
    expect(await t.query(read, { id, serverSecret: secret })).toBeNull();
  });
});
