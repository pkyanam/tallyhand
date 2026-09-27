/**
 * API v1 write idempotency for POST/PUT/PATCH mutations.
 *
 * Requests with a key replay the first stored status and JSON body. Keys are
 * namespaced by the resolved user id (`userId:key`); if user resolution is
 * unavailable, the raw key is used. Previously stored un-namespaced keys
 * become harmless orphans: there is no cleanup job, and retries across this
 * deploy boundary execute again.
 *
 * `sqlite` and `dexie` use the local SQLite file. `neon` uses the Neon HTTP
 * driver, `postgres` uses a lazy pg Pool, and `convex` currently runs without
 * persistence because Convex has no SQL table (native support is future
 * work). Persistence errors in every mode fail open to the handler so
 * idempotency degradation never turns a write into a 500. Cloud mode uses
 * first-writer-wins inserts but has no cross-request locking; concurrent
 * retries may execute twice. Neon HTTP also has no transactions, as noted in
 * `neon-provider.ts`.
 *
 * Cloud tables use BIGINT for `created_at`: Date.now() milliseconds overflow
 * Postgres INTEGER. IMPORTANT: call this only for real mutations; dry-run
 * previews must be handled before this wrapper.
 */
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/sqlite-provider";
import { parseStorage } from "@/lib/mode";
import { tryResolveUserId } from "@/lib/auth/session";

const SQLITE_TABLE = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);`;

const POSTGRES_TABLE = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);`;

interface StoredResponse {
  status: number;
  body: string;
}

type NeonSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<StoredResponse[]>;

async function namespacedKey(key: string): Promise<string> {
  try {
    const userId = await tryResolveUserId();
    return userId ? `${userId}:${key}` : key;
  } catch {
    return key;
  }
}

function normalizeNeonConnectionString(url: string): string {
  // Keep in sync with normalizeNeonConnectionString in
  // src/lib/db/neon-provider.ts, the source of truth for this rewrite.
  try {
    const parsed = new URL(url);
    if (/\.neon\.tech$/i.test(parsed.hostname) && parsed.hostname.includes("-pooler")) {
      parsed.hostname = parsed.hostname.replace(/-pooler/i, "");
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

async function withLocalSqlite(key: string, handler: () => Promise<Response>): Promise<Response> {
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(resolveDbPath());
  } catch (error) {
    console.error("Local idempotency database open failed; running handler without persistence", error);
    return handler();
  }

  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SQLITE_TABLE);
    const row = db.prepare("SELECT status, body FROM idempotency_keys WHERE key = ?").get(key) as StoredResponse | undefined;
    if (row) return new Response(row.body, { status: row.status, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("Local idempotency lookup failed; running handler without persistence", error);
    try { db.close(); } catch (closeError) { console.error("Failed to close idempotency database", closeError); }
    return handler();
  }

  const response = await handler();
  const body = await response.text();
  try {
    db.prepare("INSERT OR REPLACE INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)").run(key, response.status, body, Date.now());
  } catch (error) {
    console.error("Local idempotency store failed; returning unpersisted response", error);
  } finally {
    try { db.close(); } catch (error) { console.error("Failed to close idempotency database", error); }
  }
  return new Response(body, { status: response.status, headers: response.headers });
}

async function withCloudSql(key: string, mode: "neon" | "postgres", handler: () => Promise<Response>): Promise<Response> {
  let neonSql: NeonSql | undefined;
  let pool: import("pg").Pool | undefined;
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for cloud idempotency");

    if (mode === "neon") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(normalizeNeonConnectionString(connectionString));
      neonSql = sql as unknown as NeonSql;
      await sql([POSTGRES_TABLE] as unknown as TemplateStringsArray);
      const rows = await sql`SELECT status, body FROM idempotency_keys WHERE key = ${key}` as StoredResponse[];
      if (rows[0]) return new Response(rows[0].body, { status: rows[0].status, headers: { "content-type": "application/json" } });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require("pg") as typeof import("pg");
      pool = new Pool({ connectionString });
      await pool.query(POSTGRES_TABLE);
      const result = await pool.query("SELECT status, body FROM idempotency_keys WHERE key = $1", [key]);
      const row = result.rows[0] as StoredResponse | undefined;
      if (row) return new Response(row.body, { status: row.status, headers: { "content-type": "application/json" } });
    }
  } catch (error) {
    console.error("Cloud idempotency lookup failed; running handler without persistence", error);
    try { await pool?.end(); } catch (closeError) { console.error("Failed to close idempotency pool", closeError); }
    return handler();
  }

  const response = await handler();
  const body = await response.text();
  try {
    if (mode === "neon") {
      const sql = neonSql!;
      await sql`INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (${key}, ${response.status}, ${body}, ${Date.now()}) ON CONFLICT (key) DO NOTHING`;
    } else {
      await pool!.query("INSERT INTO idempotency_keys (key, status, body, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING", [key, response.status, body, Date.now()]);
    }
  } catch (error) {
    console.error("Cloud idempotency store failed; returning unpersisted response", error);
  } finally {
    try { await pool?.end(); } catch (error) { console.error("Failed to close idempotency pool", error); }
  }
  return new Response(body, { status: response.status, headers: response.headers });
}

/**
 * Idempotency machinery never throws or produces a 500 by itself: storage,
 * mode detection, path resolution, and key namespacing failures fail open to
 * the handler. Handler exceptions propagate unchanged after one execution.
 * Only the documented concurrent-retry race can execute a handler twice.
 */
export async function withIdempotency(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key || !["POST", "PUT", "PATCH"].includes(req.method)) return handler();
  let storedKey: string;
  try {
    storedKey = await namespacedKey(key);
  } catch {
    storedKey = key;
  }
  const mode = parseStorage();
  if (mode === "convex") return handler();
  if (mode === "neon" || mode === "postgres") return withCloudSql(storedKey, mode, handler);
  return withLocalSqlite(storedKey, handler);
}
