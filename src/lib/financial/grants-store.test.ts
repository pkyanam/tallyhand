import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFinancialGrant,
  getFinancialGrant,
  listFinancialGrants,
  revokeFinancialGrant,
} from "./grants";
describe("persisted grant revocation", () => {
  it("persists scoped grants and immediately sees revocation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tally-grants-"));
    vi.stubEnv("TALLY_STORAGE", "sqlite");
    vi.stubEnv("TALLYHAND_DB_PATH", join(dir, "grants.db"));
    try {
      const grant = await createFinancialGrant({
        userId: "u",
        workspaceId: "u",
        principal: { kind: "api-token", tokenId: "t" },
        actions: ["collect"],
        accountId: "a",
        mode: "test",
        currency: "USD",
        maxMinorUnits: 100,
      });
      expect(await getFinancialGrant("other", grant.id)).toBeNull();
      expect(await revokeFinancialGrant("other", grant.id)).toBe(false);
      expect(await listFinancialGrants("u")).toHaveLength(1);
      expect(await revokeFinancialGrant("u", grant.id)).toBe(true);
      expect((await getFinancialGrant("u", grant.id))?.revokedAt).toBeTypeOf(
        "number",
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("fails closed on database errors", async () => {
    vi.stubEnv("TALLY_STORAGE", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    try {
      await expect(getFinancialGrant("u", "g")).rejects.toThrow("unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
