/**
 * tryResolveSyncUserId: sync must be unavailable unless REAL auth is
 * configured. In local mode (TALLY_AUTH=none) resolveUserId() falls back to
 * the "local" pseudo-user — that fallback must not open the sync vault.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tryResolveSyncUserId, tryResolveUserId } from "./session";

describe("tryResolveSyncUserId", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.TALLY_AUTH;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("returns null in local mode even though tryResolveUserId returns 'local'", async () => {
    process.env.TALLY_AUTH = "none";
    expect(await tryResolveSyncUserId()).toBeNull();
    // …while the general resolver keeps its local fallback for data scoping.
    expect(await tryResolveUserId()).toBe("local");
  });

  it("returns null in builtin mode with no session cookie", async () => {
    process.env.TALLY_AUTH = "builtin";
    await expect(tryResolveSyncUserId()).resolves.toBeNull();
  });
});
