/**
 * Personal API tokens for signed-in users (`TALLY_AUTH=clerk|builtin`).
 *
 * A user creates long-lived tokens from Settings → Connect. Each token is
 * shown exactly once; only its SHA-256 hash is stored. A token authenticates
 * /api/v1 and /api/mcp exactly like the shared TALLYHAND_API_TOKEN does,
 * but is attributed to the token's owner (not TALLYHAND_HOSTED_CLI_USER_ID).
 *
 * Storage follows the active provider (`TALLY_STORAGE`):
 * - `postgres` → `api_tokens` table via raw pg (same pattern as
 *   `src/lib/auth/builtin.ts`); table is created IF NOT EXISTS on first use.
 * - `convex`   → `apiTokens` table via the `tally:apiTokens*` functions in
 *   `convex/tally.ts`.
 * - anything else (`sqlite`, or `dexie` which has no server IndexedDB) →
 *   `api_tokens` table in the server SQLite file (same file the v1
 *   idempotency keys live in).
 *
 * SERVER ONLY — pg and convex are loaded with dynamic requires to keep them
 * out of the static import graph; node:sqlite is a static import (same as
 * the v1 idempotency helper).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { newId } from "@/core/id";
import { parseStorage } from "@/lib/mode";
import { resolveDbPath } from "@/server/sqlite-provider";

export interface ApiTokenRecord {
  id: string;
  userId: string;
  name: string;
  /** First 8 chars of the raw token — display only, not a secret. */
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiTokenSecret extends ApiTokenRecord {
  /** The raw token. Returned exactly once, at creation. Never persisted. */
  token: string;
}

/** Raw tokens are `thp_` + 43 base64url chars (32 random bytes). */
export const API_TOKEN_PREFIX = "thp_";
const RAW_TOKEN_RE = /^thp_[A-Za-z0-9_-]{43}$/;

/** SHA-256 hex of the raw token — the only form ever stored. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a fresh raw token (returned to the user exactly once). */
export function mintApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

function toRecord(row: Record<string, unknown>): ApiTokenRecord {
  const lastUsedRaw = row.last_used_at ?? row.lastUsedAt ?? null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    name: String(row.name),
    prefix: String(row.prefix),
    createdAt: Number(row.created_at ?? row.createdAt),
    lastUsedAt: lastUsedRaw === null ? null : Number(lastUsedRaw),
  };
}

function normalizeName(name: string): string {
  const trimmed = name.trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : "Untitled token";
}

// -- postgres backend (raw pg, dynamic) ---------------------------------------

type PgPool = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
};

let pgPool: PgPool | null = null;
let pgEnsured = false;

function getPgPool(): PgPool {
  if (pgPool) return pgPool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("TALLY_STORAGE=postgres requires DATABASE_URL");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  pgPool = new Pool({ connectionString: url }) as unknown as PgPool;
  return pgPool;
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens (user_id);`;

async function pgEnsure(): Promise<void> {
  if (pgEnsured) return;
  await getPgPool().query(PG_SCHEMA);
  pgEnsured = true;
}

const pgBackend = {
  async create(
    rec: ApiTokenRecord & { tokenHash: string },
  ): Promise<ApiTokenRecord> {
    await pgEnsure();
    const { rows } = await getPgPool().query(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL) RETURNING *`,
      [rec.id, rec.userId, rec.name, rec.tokenHash, rec.prefix, rec.createdAt],
    );
    return toRecord(rows[0]);
  },
  async list(userId: string): Promise<ApiTokenRecord[]> {
    await pgEnsure();
    const { rows } = await getPgPool().query(
      `SELECT id, user_id, name, prefix, created_at, last_used_at
       FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toRecord);
  },
  async revoke(userId: string, id: string): Promise<boolean> {
    await pgEnsure();
    const { rowCount } = await getPgPool().query(
      `DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rowCount > 0;
  },
  async findByHash(
    tokenHash: string,
  ): Promise<(ApiTokenRecord & { tokenHash: string }) | null> {
    await pgEnsure();
    const { rows } = await getPgPool().query(
      `SELECT * FROM api_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...toRecord(row), tokenHash: String(row.token_hash) };
  },
  async touch(id: string, at: number): Promise<void> {
    await getPgPool().query(
      `UPDATE api_tokens SET last_used_at = $1 WHERE id = $2`,
      [at, id],
    );
  },
};

// -- sqlite backend (node:sqlite, dynamic) -------------------------------------

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens (user_id);`;

function sqliteDb() {
  const db = new DatabaseSync(resolveDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SQLITE_SCHEMA);
  return db;
}

const sqliteBackend = {
  async create(
    rec: ApiTokenRecord & { tokenHash: string },
  ): Promise<ApiTokenRecord> {
    const db = sqliteDb();
    try {
      db.prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ).run(rec.id, rec.userId, rec.name, rec.tokenHash, rec.prefix, rec.createdAt);
      return { ...rec };
    } finally {
      db.close();
    }
  },
  async list(userId: string): Promise<ApiTokenRecord[]> {
    const db = sqliteDb();
    try {
      const rows = db
        .prepare(
          `SELECT id, user_id, name, prefix, created_at, last_used_at
           FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
        )
        .all(userId) as Record<string, unknown>[];
      return rows.map(toRecord);
    } finally {
      db.close();
    }
  },
  async revoke(userId: string, id: string): Promise<boolean> {
    const db = sqliteDb();
    try {
      const res = db
        .prepare(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`)
        .run(id, userId);
      return Number(res.changes) > 0;
    } finally {
      db.close();
    }
  },
  async findByHash(
    tokenHash: string,
  ): Promise<(ApiTokenRecord & { tokenHash: string }) | null> {
    const db = sqliteDb();
    try {
      const row = db
        .prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`)
        .get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return null;
      return { ...toRecord(row), tokenHash: String(row.token_hash) };
    } finally {
      db.close();
    }
  },
  async touch(id: string, at: number): Promise<void> {
    const db = sqliteDb();
    try {
      db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).run(at, id);
    } finally {
      db.close();
    }
  },
};

// -- convex backend (ConvexHttpClient, dynamic) --------------------------------

type ConvexClientLike = {
  query: (path: string, args: Record<string, unknown>) => Promise<unknown>;
  mutation: (path: string, args: Record<string, unknown>) => Promise<unknown>;
};

let convexClient: ConvexClientLike | null = null;

function getConvexClient(): ConvexClientLike {
  if (convexClient) return convexClient;
  const url = process.env.CONVEX_URL;
  if (!url) throw new Error("TALLY_STORAGE=convex requires CONVEX_URL");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ConvexHttpClient } = require("convex/browser") as typeof import(
    "convex/browser"
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeFunctionReference } = require("convex/server") as typeof import(
    "convex/server"
  );
  const http = new ConvexHttpClient(url);
  convexClient = {
    query: (path, args) =>
      http.query(makeFunctionReference<"query">(`tally:${path}`), args),
    mutation: (path, args) =>
      http.mutation(makeFunctionReference<"mutation">(`tally:${path}`), args),
  };
  return convexClient;
}

const convexBackend = {
  async create(
    rec: ApiTokenRecord & { tokenHash: string },
  ): Promise<ApiTokenRecord> {
    const doc = (await getConvexClient().mutation("apiTokensCreate", {
      userId: rec.userId,
      id: rec.id,
      name: rec.name,
      tokenHash: rec.tokenHash,
      prefix: rec.prefix,
      createdAt: rec.createdAt,
    })) as Record<string, unknown>;
    return toRecord(doc);
  },
  async list(userId: string): Promise<ApiTokenRecord[]> {
    const docs = (await getConvexClient().query("apiTokensList", {
      userId,
    })) as Record<string, unknown>[];
    return docs.map(toRecord);
  },
  async revoke(userId: string, id: string): Promise<boolean> {
    const res = (await getConvexClient().mutation("apiTokensRevoke", {
      userId,
      id,
    })) as { revoked: boolean };
    return res.revoked;
  },
  async findByHash(
    tokenHash: string,
  ): Promise<(ApiTokenRecord & { tokenHash: string }) | null> {
    const doc = (await getConvexClient().query("apiTokensFindByHash", {
      tokenHash,
    })) as Record<string, unknown> | null;
    if (!doc) return null;
    return { ...toRecord(doc), tokenHash: String(doc.tokenHash) };
  },
  async touch(id: string, at: number): Promise<void> {
    await getConvexClient().mutation("apiTokensTouch", { id, lastUsedAt: at });
  },
};

// -- public API -----------------------------------------------------------------

type Backend = typeof pgBackend;

function getBackend(): Backend {
  const storage = parseStorage();
  if (storage === "postgres" || storage === "neon") return pgBackend;
  if (storage === "convex") return convexBackend;
  // sqlite, and dexie (no IndexedDB server-side) → server SQLite file.
  return sqliteBackend;
}

/**
 * Create a token for `userId`. Returns the record plus the raw token —
 * the ONLY time the raw value is available. Store only the hash.
 */
export async function createApiToken(
  userId: string,
  name: string,
): Promise<ApiTokenSecret> {
  if (!userId) throw new Error("userId is required");
  const token = mintApiToken();
  const rec: ApiTokenRecord & { tokenHash: string } = {
    id: newId("tok"),
    userId,
    name: normalizeName(name),
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, 8),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  const stored = await getBackend().create(rec);
  return { ...stored, token };
}

/** List a user's tokens (newest first). Hashes are never returned. */
export async function listApiTokens(userId: string): Promise<ApiTokenRecord[]> {
  if (!userId) return [];
  return getBackend().list(userId);
}

/** Revoke (delete) a token. Returns true when a row was removed. */
export async function revokeApiToken(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!userId || !id) return false;
  return getBackend().revoke(userId, id);
}

export interface VerifiedApiToken {
  id: string;
  userId: string;
  name: string;
}

/**
 * Verify a presented raw token. Returns the token's owner on success,
 * null otherwise. Updates last_used_at on success (best-effort).
 */
export async function findApiToken(
  token: string,
): Promise<VerifiedApiToken | null> {
  if (!RAW_TOKEN_RE.test(token)) return null;
  const hash = hashApiToken(token);
  const row = await getBackend().findByHash(hash);
  if (!row) return null;
  // Constant-time compare: the DB lookup already matched, this closes any
  // residual timing signal from index probing.
  const a = Buffer.from(row.tokenHash, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const now = Date.now();
  try {
    await getBackend().touch(row.id, now);
  } catch {
    /* last_used_at is advisory — never fail auth on it */
  }
  return { id: row.id, userId: row.userId, name: row.name };
}

/** Test hook: reset module-level backend caches between tests. */
export function __resetApiTokenCaches(): void {
  pgPool = null;
  pgEnsured = false;
  convexClient = null;
}
