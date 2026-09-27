/**
 * SERVER ONLY — never import from client components.
 *
 * Server-side provider for the REST API v1 routes, CLI, and MCP server.
 *
 * Selection is env-driven:
 * - `TALLY_STORAGE=postgres` → Drizzle/Postgres, per-request user scoping.
 * - `TALLY_STORAGE=convex`   → Convex, per-request user scoping.
 * - `TALLY_STORAGE=sqlite`  → local node:sqlite file (zero deps).
 * - `TALLY_STORAGE=dexie`    → browser-only; server-side code falls back to
 *   the local sqlite file backend (IndexedDB doesn't exist server-side).
 *
 * The owner id comes from `TALLY_AUTH` (clerk|builtin|none) via
 * `resolveUserId()`, passed as a LAZY async resolver so this function stays
 * synchronous while the session lookup stays request-scoped. In hosted
 * modes there is deliberately no cached/global user: every call builds a
 * provider bound to the current request's user.
 *
 * Heavy deps (pg, drizzle-orm, convex, @clerk/nextjs) are loaded with
 * `require` inside the branch that needs them, so local mode, vitest, and
 * edge bundles never load them.
 */
import { getConfig, effectiveAuth } from "@/lib/mode";
import { SqliteStorageProvider, makeSqliteProvider } from "./sqlite-provider";
import type { StorageProvider } from "@/core/storage";
import type { UserIdSource } from "@/lib/db/hosted-types";
import type { DbLike } from "@/lib/db/postgres-provider";
import type { ConvexClientLike } from "@/lib/db/convex-provider";
import { readOnlyIfViewer } from "@/lib/auth/read-only";


let sqliteSingleton: StorageProvider | null = null;
let pgDb: unknown | null = null;
let convexClient: unknown | null = null;
let warnedDexieFallback = false;

function getSqliteProvider(): StorageProvider {
  if (!sqliteSingleton) {
    sqliteSingleton = makeSqliteProvider();
  }
  return sqliteSingleton;
}

function getPgDb(): unknown {
  if (!pgDb) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("TALLY_STORAGE=postgres requires DATABASE_URL");
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/node-postgres") as typeof import(
      "drizzle-orm/node-postgres"
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schema = require("@/lib/db/postgres-schema") as typeof import(
      "@/lib/db/postgres-schema"
    );
    pgDb = drizzle(new Pool({ connectionString: databaseUrl }), { schema });
  }
  return pgDb;
}

function getConvexClient(): unknown {
  if (!convexClient) {
    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      throw new Error("TALLY_STORAGE=convex requires CONVEX_URL");
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConvexHttpClient } = require("convex/browser") as typeof import(
      "convex/browser"
    );
    convexClient = new ConvexHttpClient(convexUrl);
  }
  return convexClient;
}

function lazyUserId(): () => Promise<string> {
  // Dynamic import (not require): keeps the next/headers-dependent session
  // module out of the static graph AND resolves under vitest's ESM loader,
  // where a bare require() cannot resolve the "@/" alias.
  return () => import("@/lib/auth/session").then((m) => m.resolveUserId());
}

function makeProvider(userIdSource: UserIdSource): StorageProvider {
  const { storage } = getConfig();

  if (storage === "postgres") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostgresStorageProvider } = require("@/lib/db/postgres-provider") as typeof import(
      "@/lib/db/postgres-provider"
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { eq, and, desc } = require("drizzle-orm") as {
      eq: (c: unknown, v: unknown) => unknown;
      and: (...cs: unknown[]) => unknown;
      desc: (c: unknown) => unknown;
    };
    return new PostgresStorageProvider(getPgDb() as DbLike, userIdSource, { eq, and, desc });
  }

  if (storage === "convex") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConvexStorageProvider } = require("@/lib/db/convex-provider") as typeof import(
      "@/lib/db/convex-provider"
    );
    return new ConvexStorageProvider(getConvexClient() as ConvexClientLike, userIdSource);
  }

  if (storage === "dexie" && !warnedDexieFallback) {
    warnedDexieFallback = true;
    console.warn(
      "[tallyhand] TALLY_STORAGE=dexie is browser-only; server-side API/CLI using the local sqlite backend.",
    );
  }
  return getSqliteProvider();
}

/**
 * The server provider for the CURRENT request: user id resolved lazily from
 * TALLY_AUTH (clerk session / builtin session cookie / API token / "local").
 * In hosted auth modes the provider is wrapped so the `viewer` role is
 * read-only (writes throw 403).
 */
export function getServerProvider(): StorageProvider {
  const source = lazyUserId();
  const base = makeProvider(source);
  return effectiveAuth() === "none" ? base : readOnlyIfViewer(base, source);
}

/**
 * A server provider explicitly scoped to one user id. Used by share-token
 * resolution, which loads the LINK OWNER's data after HMAC verification.
 */
export function getServerProviderForUser(userId: string): StorageProvider {
  return makeProvider(userId);
}

/** Test helper: drop cached singletons so the next getServerProvider() rebuilds. */
export function resetServerProviderForTests(): void {
  if (sqliteSingleton instanceof SqliteStorageProvider) {
    try {
      sqliteSingleton.close();
    } catch {
      /* ignore */
    }
  }
  sqliteSingleton = null;
  const pg = pgDb as { $client?: { end?: () => Promise<unknown> } } | null;
  try {
    void pg?.$client?.end?.();
  } catch {
    /* ignore */
  }
  pgDb = null;
  convexClient = null;
  warnedDexieFallback = false;
}
