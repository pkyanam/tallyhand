/**
 * Personal API tokens: pg-backend round-trip integration test.
 *
 * Production (Vercel + Neon) resolves to the raw-pg backend
 * (`getBackend()` maps TALLY_STORAGE=neon → pgBackend). This suite drives
 * the REAL pgBackend code — `createApiToken()` → `pg.create()` →
 * `findByHash(hashApiToken(raw))` → `findApiToken(raw)` — against an
 * in-memory fake of the `pg` Pool's query surface, so the SQL the backend
 * issues (columns, params, RETURNING *) is exercised exactly as written.
 *
 * What it proves: the token returned to Settings → Connect is the same
 * value whose SHA-256 lands in `token_hash`, and presenting that token
 * verifies. If UI-created tokens fail verification in production while
 * this passes, the cause is environmental (wrong DB, stale deploy,
 * comparing against the wrong row) — not the mint/hash/store path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetApiTokenCaches,
  createApiToken,
  findApiToken,
  hashApiToken,
  listApiTokens,
  revokeApiToken,
} from "./api-tokens";

// In-memory stand-in for the api_tokens table, shared with the mocked pg
// module below. Reset before each test.
const fakePgStore = vi.hoisted(
  () => ({ rows: new Map<string, Record<string, unknown>>() }),
);

type PgParams = unknown[];

vi.mock("pg", () => {
  class FakePool {
    async query(text: string, params: PgParams = []) {
      const t = text.trim().replace(/\s+/g, " ").toUpperCase();
      if (t.startsWith("CREATE TABLE")) {
        return { rows: [], rowCount: 0 };
      }
      if (t.startsWith("INSERT INTO API_TOKENS")) {
        const [id, user_id, name, token_hash, prefix, created_at] = params as [
          unknown,
          unknown,
          unknown,
          unknown,
          unknown,
          unknown,
        ];
        for (const r of fakePgStore.rows.values()) {
          if (r.token_hash === token_hash) {
            throw new Error(
              'duplicate key value violates unique constraint "api_tokens_token_hash_key"',
            );
          }
        }
        const row = {
          id,
          user_id,
          name,
          token_hash,
          prefix,
          created_at,
          last_used_at: null,
        };
        fakePgStore.rows.set(String(id), row);
        return { rows: [row], rowCount: 1 };
      }
      if (t.startsWith("SELECT") && t.includes("FROM API_TOKENS")) {
        let found: Record<string, unknown> | undefined;
        if (t.includes("WHERE TOKEN_HASH")) {
          found = [...fakePgStore.rows.values()].find(
            (r) => r.token_hash === params[0],
          );
        } else if (t.includes("WHERE USER_ID")) {
          const list = [...fakePgStore.rows.values()]
            .filter((r) => r.user_id === params[0])
            .sort(
              (a, b) =>
                Number(b.created_at ?? 0) - Number(a.created_at ?? 0),
            );
          return { rows: list, rowCount: list.length };
        }
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (t.startsWith("DELETE FROM API_TOKENS")) {
        const [id, user_id] = params as [unknown, unknown];
        const row = fakePgStore.rows.get(String(id));
        const ok = !!row && row.user_id === user_id;
        if (ok) fakePgStore.rows.delete(String(id));
        return { rows: [], rowCount: ok ? 1 : 0 };
      }
      if (t.startsWith("UPDATE API_TOKENS SET LAST_USED_AT")) {
        const [at, id] = params as [unknown, unknown];
        const row = fakePgStore.rows.get(String(id));
        if (row) row.last_used_at = at;
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`FakePool: unhandled query: ${text.slice(0, 80)}`);
    }
  }
  return { Pool: FakePool };
});

const USER = "user_pg_roundtrip";

describe("api tokens — pg backend round trip", () => {
  let savedStorage: string | undefined;
  let savedDbUrl: string | undefined;

  beforeEach(() => {
    savedStorage = process.env.TALLY_STORAGE;
    savedDbUrl = process.env.DATABASE_URL;
    // neon → pgBackend (the production mapping on Vercel).
    process.env.TALLY_STORAGE = "neon";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    fakePgStore.rows.clear();
    __resetApiTokenCaches();
  });

  afterEach(() => {
    if (savedStorage === undefined) delete process.env.TALLY_STORAGE;
    else process.env.TALLY_STORAGE = savedStorage;
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    __resetApiTokenCaches();
  });

  it("createApiToken stores hashApiToken(raw token); findApiToken verifies it", async () => {
    const secret = await createApiToken(USER, "MacBook CLI");

    // Exactly one row, and its stored hash equals the hash of the RAW token
    // handed to the caller (the UI displays this same value).
    expect(fakePgStore.rows.size).toBe(1);
    const stored = [...fakePgStore.rows.values()][0];
    expect(stored.user_id).toBe(USER);
    expect(stored.token_hash).toBe(hashApiToken(secret.token));
    expect(stored.prefix).toBe(secret.token.slice(0, 8));

    // End-to-end: presenting the raw token verifies and attributes the owner.
    const verified = await findApiToken(secret.token);
    expect(verified).toMatchObject({ userId: USER, name: "MacBook CLI" });

    // A single altered character must not verify (still well-formed).
    const last = secret.token.slice(-1);
    const tampered = secret.token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(await findApiToken(tampered)).toBeNull();
  });

  it("no double-mint: one createApiToken call stores exactly one hash", async () => {
    const secret = await createApiToken(USER, "single");
    expect(fakePgStore.rows.size).toBe(1);
    // The returned token is the ONLY raw value; nothing else in the store
    // can verify against it.
    const verified = await findApiToken(secret.token);
    expect(verified?.id).toBe(secret.id);
  });

  it("revoke removes the hash so the token stops verifying", async () => {
    const secret = await createApiToken(USER, "temp");
    expect(await findApiToken(secret.token)).not.toBeNull();
    expect(await revokeApiToken(USER, secret.id)).toBe(true);
    expect(await findApiToken(secret.token)).toBeNull();
    expect(await listApiTokens(USER)).toHaveLength(0);
  });
});
