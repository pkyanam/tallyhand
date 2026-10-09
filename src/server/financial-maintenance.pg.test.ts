import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";
import {
  discoverFinancialScopes,
  claimFinancialRecoveryRun,
  finishFinancialRecoveryRun,
  getFinancialScopeRecoveryCheckpoint,
  saveFinancialScopeRecoveryCheckpoint,
} from "./financial-maintenance";
import { FINANCIAL_POSTGRES_SCHEMA } from "@/lib/financial/postgres-store";
const url = process.env.FINANCIAL_TEST_DATABASE_URL;
describe.skipIf(!url)(
  "real PostgreSQL maintenance (disposable database required)",
  () => {
    let db: Pool;
    beforeAll(async () => {
      vi.stubEnv("DATABASE_URL", url!);
      vi.stubEnv("TALLY_STORAGE", "postgres");
      db = new Pool({ connectionString: url });
      await db.query(FINANCIAL_POSTGRES_SCHEMA);
      await db.query(
        "CREATE TABLE IF NOT EXISTS financial_maintenance(id TEXT PRIMARY KEY,value JSONB NOT NULL DEFAULT '{}'::jsonb,lease_token TEXT,lease_expires_at BIGINT)",
      );
    });
    beforeEach(async () => {
      await db.query("TRUNCATE financial_records,financial_maintenance");
    });
    afterAll(async () => {
      await db.end();
      vi.unstubAllEnvs();
    });
    it("discovers actual plural adapter records with account/mode scope pagination", async () => {
      for (const [id, kind, mode] of [
        ["a", "attempts", "test"],
        ["b", "payments", "test"],
        ["c", "events", "live"],
      ])
        await db.query(
          "INSERT INTO financial_records(user_id,workspace_id,kind,id,provider,account_id,mode,data) VALUES($1,$1,$2,$1,'stripe',$3,$4,'{}'::jsonb)",
          [id, kind, `acct_${id}`, mode],
        );
      const first = await discoverFinancialScopes({ limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();
      const second = await discoverFinancialScopes({
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0].mode).toBe("live");
    });
    it("claims atomically and reloads durable cursors after fenced completion", async () => {
      const claims = await Promise.all([
        claimFinancialRecoveryRun(),
        claimFinancialRecoveryRun(),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const run = claims.find(Boolean)!;
      await expect(
        finishFinancialRecoveryRun("wrong", { scopes: {} }),
      ).rejects.toThrow("Recovery lease stale");
      await finishFinancialRecoveryRun(run.token, {
        scopeCursor: "next",
        scopes: { scope: { providerCursors: { "attempt:a": "cs_cursor" } } },
      });
      const resumed = await claimFinancialRecoveryRun();
      expect(resumed?.state).toEqual({
        scopeCursor: "next",
        scopes: { scope: { providerCursors: { "attempt:a": "cs_cursor" } } },
      });
    });
    it("persists independent scope progress fenced by the global run lease", async () => {
      const key = "a".repeat(64);
      const run = await claimFinancialRecoveryRun();
      await saveFinancialScopeRecoveryCheckpoint(run!.token, key, {
        workCursor: "resume",
      });
      await expect(
        saveFinancialScopeRecoveryCheckpoint("wrong", key, {
          workCursor: "overwrite",
        }),
      ).rejects.toThrow("Recovery lease stale");
      await finishFinancialRecoveryRun(run!.token, {
        scopeCursor: "nextpage",
        scopes: {},
      });
      expect(await getFinancialScopeRecoveryCheckpoint(key)).toEqual({
        workCursor: "resume",
      });
      const second = await claimFinancialRecoveryRun();
      await saveFinancialScopeRecoveryCheckpoint(second!.token, key, null);
      expect(await getFinancialScopeRecoveryCheckpoint(key)).toBeNull();
    });
  },
);
