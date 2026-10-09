import { randomUUID } from "node:crypto";
import { parseStorage } from "@/lib/mode";
import type { FinancialScope, Page, PageQuery } from "@/core/financial/types";
import type { FinancialRecoveryCheckpoint } from "./financial-worker";
const RUN_ID = "financial-recovery";
function cloud() {
  return import("@/lib/db/convex-client").then(
    ({ createConvexRequestClient }) =>
      createConvexRequestClient(
        process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
      ),
  );
}
const isPg = () => ["postgres", "neon"].includes(parseStorage());
let pool: Pick<import("pg").Pool, "query"> | undefined;
async function pg() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("Financial maintenance database unavailable");
    if (new URL(connectionString).hostname.endsWith(".neon.tech")) {
      const { Pool, neonConfig } = await import("@neondatabase/serverless");
      const { default: WebSocket } = await import("ws");
      neonConfig.webSocketConstructor = WebSocket;
      pool = new Pool({ connectionString, max: 2 }) as unknown as Pick<
        import("pg").Pool,
        "query"
      >;
    } else {
      const { Pool } = await import("pg");
      pool = new Pool({ connectionString, max: 2 });
    }
  }
  const { FINANCIAL_POSTGRES_SCHEMA } =
    await import("@/lib/financial/postgres-store");
  await pool.query(FINANCIAL_POSTGRES_SCHEMA);
  await pool.query(
    "CREATE TABLE IF NOT EXISTS financial_maintenance(id TEXT PRIMARY KEY,value JSONB NOT NULL DEFAULT '{}'::jsonb,lease_token TEXT,lease_expires_at BIGINT)",
  );
  return pool;
}
async function sqlite() {
  const [{ resolveDbPath }, store] = await Promise.all([
    import("./sqlite-provider"),
    import("@/lib/financial/sqlite-store"),
  ]);
  return { path: resolveDbPath(), store };
}
export async function discoverFinancialScopes(
  query: PageQuery,
): Promise<Page<FinancialScope>> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
    throw new Error("Discovery limit invalid");
  if (parseStorage() === "convex")
    return (await (
      await cloud()
    ).query("financialMaintenance:discover", {
      ...query,
    })) as Page<FinancialScope>;
  if (isPg()) {
    const db = await pg();
    await db.query(
      "CREATE INDEX IF NOT EXISTS financial_maintenance_scopes_idx ON financial_records(provider,account_id,mode,user_id,workspace_id,kind,id)",
    );
    const cursor = query.cursor
      ? (JSON.parse(
          Buffer.from(query.cursor, "base64url").toString(),
        ) as string[])
      : ["", "", "", "", ""];
    const result = await db.query(
      `SELECT DISTINCT provider,account_id,mode,user_id,workspace_id FROM financial_records WHERE kind IN ('attempts','payments','events') AND provider='stripe' AND (provider,account_id,mode,user_id,workspace_id)>($1,$2,$3,$4,$5) ORDER BY provider,account_id,mode,user_id,workspace_id LIMIT $6`,
      [...cursor, query.limit + 1],
    );
    const items = result.rows.slice(0, query.limit).map((row) => ({
      provider: "stripe" as const,
      accountId: String(row.account_id),
      mode: row.mode as "test" | "live",
      userId: String(row.user_id),
      workspaceId: String(row.workspace_id),
    }));
    const last = items.at(-1);
    return {
      items,
      ...(result.rows.length > query.limit && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify([
                last.provider,
                last.accountId,
                last.mode,
                last.userId,
                last.workspaceId,
              ]),
            ).toString("base64url"),
          }
        : {}),
    };
  }
  const { path, store } = await sqlite();
  return store.listSqliteFinancialScopes(path, query.limit, query.cursor);
}
export async function claimFinancialRecoveryRun() {
  const now = Date.now(),
    lease = { token: randomUUID(), expiresAt: now + 300_000 };
  let progress: Record<string, unknown> | null = null;
  if (parseStorage() === "convex")
    progress = (await (
      await cloud()
    ).mutation("financialMaintenance:claim", {
      id: RUN_ID,
      lease,
      now,
    })) as Record<string, unknown> | null;
  else if (isPg()) {
    const db = await pg();
    const r = await db.query(
      `INSERT INTO financial_maintenance(id,value,lease_token,lease_expires_at) VALUES($1,'{}'::jsonb,$2,$3) ON CONFLICT(id) DO UPDATE SET lease_token=$2,lease_expires_at=$3 WHERE financial_maintenance.lease_expires_at IS NULL OR financial_maintenance.lease_expires_at<=$4 RETURNING value`,
      [RUN_ID, lease.token, lease.expiresAt, now],
    );
    progress = r.rows[0]?.value ?? null;
  } else {
    const { path, store } = await sqlite();
    if (
      store.claimSqliteFinancialRecoveryRun(
        path,
        lease.token,
        now,
        lease.expiresAt,
      )
    )
      progress =
        (store.getSqliteFinancialRecoveryCheckpoint(path) as unknown as Record<
          string,
          unknown
        >) ?? {};
  }
  return progress
    ? {
        token: lease.token,
        state: { scopes: {}, ...progress } as FinancialRecoveryCheckpoint,
      }
    : null;
}
export async function finishFinancialRecoveryRun(
  token: string,
  state: FinancialRecoveryCheckpoint,
) {
  if (Object.keys(state.scopes).length > 100)
    throw new Error("Recovery checkpoint exceeds bounded scopes");
  const clean = JSON.parse(JSON.stringify(state));
  const now = Date.now();
  if (parseStorage() === "convex") {
    await (
      await cloud()
    ).mutation("financialMaintenance:finish", {
      id: RUN_ID,
      leaseToken: token,
      now,
      progress: clean,
    });
    return;
  }
  if (isPg()) {
    const r = await (
      await pg()
    ).query(
      "UPDATE financial_maintenance SET value=$1,lease_token=NULL,lease_expires_at=NULL WHERE id=$2 AND lease_token=$3 AND lease_expires_at>$4",
      [clean, RUN_ID, token, now],
    );
    if (!r.rowCount) throw new Error("Recovery lease stale");
    return;
  }
  const { path, store } = await sqlite();
  store.saveSqliteFinancialRecoveryCheckpoint(path, token, clean, now);
}

/** Each scope has independent durable progress; discovery advances fairly. */
export async function getFinancialScopeRecoveryCheckpoint(scopeKey: string) {
  if (!/^[a-f0-9]{64}$/.test(scopeKey))
    throw new Error("Recovery scope key invalid");
  const id = `scope:${scopeKey}`;
  if (parseStorage() === "convex")
    return (await (
      await cloud()
    ).query("financialMaintenance:scopeProgress", { id })) as
      import("./financial-worker").FinancialRecoveryCursors | null;
  if (isPg()) {
    const r = await (
      await pg()
    ).query("SELECT value FROM financial_maintenance WHERE id=$1", [id]);
    return r.rows[0]?.value ?? null;
  }
  const { DatabaseSync } = await import("node:sqlite");
  const { path } = await sqlite();
  const db = new DatabaseSync(path);
  try {
    const row = db
      .prepare("SELECT data FROM financial_recovery_checkpoint WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}
export async function saveFinancialScopeRecoveryCheckpoint(
  token: string,
  scopeKey: string,
  progress: import("./financial-worker").FinancialRecoveryCursors | null,
) {
  if (!/^[a-f0-9]{64}$/.test(scopeKey))
    throw new Error("Recovery scope key invalid");
  const id = `scope:${scopeKey}`,
    now = Date.now();
  const clean = progress ? JSON.parse(JSON.stringify(progress)) : null;
  if (parseStorage() === "convex") {
    await (
      await cloud()
    ).mutation("financialMaintenance:saveScopeProgress", {
      id,
      runId: RUN_ID,
      leaseToken: token,
      now,
      progress: clean,
    });
    return;
  }
  if (isPg()) {
    const db = await pg();
    const c = await (db as import("pg").Pool).connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(
        "SELECT id FROM financial_maintenance WHERE id=$1 AND lease_token=$2 AND lease_expires_at>$3 FOR UPDATE",
        [RUN_ID, token, now],
      );
      if (!r.rowCount) throw new Error("Recovery lease stale");
      if (clean)
        await c.query(
          "INSERT INTO financial_maintenance(id,value) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET value=$2",
          [id, clean],
        );
      else await c.query("DELETE FROM financial_maintenance WHERE id=$1", [id]);
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
    return;
  }
  const { DatabaseSync } = await import("node:sqlite");
  const { path } = await sqlite();
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const lease = db
      .prepare(
        "SELECT id FROM financial_recovery_checkpoint WHERE id='global' AND lease_token=? AND lease_expires_at>?",
      )
      .get(token, now);
    if (!lease) throw new Error("Recovery lease stale");
    if (clean)
      db.prepare(
        "INSERT INTO financial_recovery_checkpoint(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      ).run(id, JSON.stringify(clean));
    else
      db.prepare("DELETE FROM financial_recovery_checkpoint WHERE id=?").run(
        id,
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
