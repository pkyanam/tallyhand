import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  claim: vi.fn(),
  finish: vi.fn(),
  discover: vi.fn(),
  store: vi.fn(),
  recover: vi.fn(),
  notify: vi.fn(),
  readScope: vi.fn(),
  saveScope: vi.fn(),
}));
vi.mock("./financial-maintenance", () => ({
  claimFinancialRecoveryRun: m.claim,
  finishFinancialRecoveryRun: m.finish,
  discoverFinancialScopes: m.discover,
  getFinancialScopeRecoveryCheckpoint: m.readScope,
  saveFinancialScopeRecoveryCheckpoint: m.saveScope,
}));
vi.mock("./financial-store", () => ({ getFinancialStore: m.store }));
vi.mock("./financial-recovery", () => ({ recoverFinancialWork: m.recover }));
vi.mock("./financial-notifications", () => ({
  drainFinancialNotifications: m.notify,
}));
import { runFinancialRecoveryBatch } from "./financial-worker";
const scope = (userId: string) => ({
  userId,
  workspaceId: userId,
  accountId: `acct_${userId}`,
  provider: "stripe",
  mode: "test",
});
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks();
  m.readScope.mockResolvedValue(null);
  m.saveScope.mockResolvedValue(undefined);
  m.claim.mockResolvedValue({ token: "lease", state: { scopes: {} } });
  m.discover.mockResolvedValue({ items: [scope("a"), scope("b")] });
  m.recover.mockResolvedValue({ providerCursors: {}, backlog: false });
});
describe("scheduled financial recovery", () => {
  it("isolates workspace failures and persists continuation without leaking provider errors", async () => {
    m.recover
      .mockRejectedValueOnce(new Error("secret_sk_live_credential"))
      .mockResolvedValueOnce({
        nextCursor: "resume",
        providerCursors: {},
        backlog: true,
      });
    const result = await runFinancialRecoveryBatch();
    expect(result.results.map((r) => r.status)).toEqual(["retry", "recovered"]);
    expect(JSON.stringify(result)).not.toContain("secret_sk");
    expect(m.finish).toHaveBeenCalledWith(
      "lease",
      expect.objectContaining({ scopes: expect.any(Object) }),
    );
    expect(m.notify).toHaveBeenCalledTimes(2);
  });
  it("prevents overlapping runs before database/provider work", async () => {
    m.claim.mockResolvedValueOnce(null);
    expect(await runFinancialRecoveryBatch()).toMatchObject({
      skipped: "already_running",
    });
    expect(m.discover).not.toHaveBeenCalled();
    expect(m.recover).not.toHaveBeenCalled();
  });
  it("delivers existing notifications before slow provider work exhausts the budget", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    m.recover.mockImplementationOnce(async () => {
      expect(m.notify).toHaveBeenCalledWith(undefined, scope("a"), 26_000);
      now += 45_001;
      return { nextCursor: "work2", providerCursors: {}, backlog: true };
    });
    await runFinancialRecoveryBatch();
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.saveScope).toHaveBeenCalledWith("lease", expect.any(String), expect.objectContaining({ workCursor: "work2" }));
  });
  it("replays persisted scope cursors and clears completed progress", async () => {
    const state = { scopes: {} };
    m.claim.mockResolvedValue({ token: "lease", state });
    await runFinancialRecoveryBatch();
    expect(m.finish).toHaveBeenCalledWith("lease", {
      scopes: {},
      scopeCursor: undefined,
    });
    expect(m.recover.mock.calls[0][3].deadline).toEqual(expect.any(Number));
  });
  it("rotates past an over-budget scope and restores its independent progress next cycle", async () => {
    const state = { scopes: {} };
    const progress = new Map<string, unknown>();
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    m.claim.mockResolvedValue({ token: "lease", state });
    m.readScope.mockImplementation(async (key) => progress.get(key) ?? null);
    m.saveScope.mockImplementation(async (_token, key, value) => {
      if (value) progress.set(key, value);
      else progress.delete(key);
    });
    m.discover.mockImplementation(async ({ cursor }) =>
      cursor === "page2"
        ? { items: [scope("c")] }
        : { items: [scope("a"), scope("b")], nextCursor: "page2" },
    );
    m.recover
      .mockImplementationOnce(async () => {
        now += 45_001;
        return { nextCursor: "work2", providerCursors: {}, backlog: true };
      })
      .mockResolvedValue({ providerCursors: {}, backlog: false });
    await runFinancialRecoveryBatch();
    expect(state).toMatchObject({ scopeOffset: 1 });
    await runFinancialRecoveryBatch();
    expect(state).toMatchObject({ scopeCursor: "page2" });
    await runFinancialRecoveryBatch();
    await runFinancialRecoveryBatch();
    expect(m.store.mock.calls.map((c) => c[0])).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
    ]);
    expect(m.recover.mock.calls[3][3]).toMatchObject({ workCursor: "work2" });
    expect(progress.size).toBe(0);
  });
});
