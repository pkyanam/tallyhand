import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimFinancialRecoveryRun,
  finishFinancialRecoveryRun,
  getFinancialScopeRecoveryCheckpoint,
  saveFinancialScopeRecoveryCheckpoint,
} from "./financial-maintenance";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maintenance-"));
  vi.stubEnv("TALLYHAND_DB_PATH", join(dir, "financial.sqlite"));
  vi.stubEnv("TALLY_STORAGE", "sqlite");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
it("persists SQLite scope progress independently and rejects a stale global lease", async () => {
  const key = "f".repeat(64),
    run = await claimFinancialRecoveryRun();
  await saveFinancialScopeRecoveryCheckpoint(run!.token, key, {
    providerCursors: { "attempt:a": "cs_continue" },
  });
  await expect(
    saveFinancialScopeRecoveryCheckpoint("wrong", key, null),
  ).rejects.toThrow("Recovery lease stale");
  await finishFinancialRecoveryRun(run!.token, {
    scopeCursor: "page2",
    scopes: {},
  });
  expect(await getFinancialScopeRecoveryCheckpoint(key)).toEqual({
    providerCursors: { "attempt:a": "cs_continue" },
  });
  const second = await claimFinancialRecoveryRun();
  expect(second?.state.scopeCursor).toBe("page2");
  await saveFinancialScopeRecoveryCheckpoint(second!.token, key, null);
  expect(await getFinancialScopeRecoveryCheckpoint(key)).toBeNull();
});
