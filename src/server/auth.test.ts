/**
 * requireApiToken: the shared env token and personal thp_ tokens both
 * authenticate /api/v1 and /api/mcp.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tempDbPath } from "@/server/sqlite-provider";
import { requireApiToken } from "./auth";
import {
  __resetApiTokenCaches,
  createApiToken,
} from "@/lib/auth/api-tokens";

const SHARED = "test-shared-token";

function reqWith(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost:3000/api/v1/clients", { headers });
}

describe("requireApiToken", () => {
  let savedToken: string | undefined;
  let savedDbPath: string | undefined;
  let savedStorage: string | undefined;
  let dbPath: string;

  beforeEach(() => {
    savedToken = process.env.TALLYHAND_API_TOKEN;
    savedDbPath = process.env.TALLYHAND_DB_PATH;
    savedStorage = process.env.TALLY_STORAGE;
    dbPath = tempDbPath("tallyhand-authtest");
    process.env.TALLYHAND_DB_PATH = dbPath;
    process.env.TALLY_STORAGE = "sqlite";
    __resetApiTokenCaches();
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.TALLYHAND_API_TOKEN;
    else process.env.TALLYHAND_API_TOKEN = savedToken;
    if (savedDbPath === undefined) delete process.env.TALLYHAND_DB_PATH;
    else process.env.TALLYHAND_DB_PATH = savedDbPath;
    if (savedStorage === undefined) delete process.env.TALLY_STORAGE;
    else process.env.TALLY_STORAGE = savedStorage;
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("accepts the shared TALLYHAND_API_TOKEN", async () => {
    process.env.TALLYHAND_API_TOKEN = SHARED;
    expect(await requireApiToken(reqWith(SHARED))).toBeNull();
  });

  it("rejects wrong or missing tokens with 401", async () => {
    process.env.TALLYHAND_API_TOKEN = SHARED;
    const wrong = await requireApiToken(reqWith("nope"));
    expect(wrong?.status).toBe(401);
    const missing = await requireApiToken(reqWith(null));
    expect(missing?.status).toBe(401);
  });

  it("returns 503 when no shared token is configured and no personal token matches", async () => {
    delete process.env.TALLYHAND_API_TOKEN;
    const res = await requireApiToken(reqWith(null));
    expect(res?.status).toBe(503);
  });

  it("accepts a personal thp_ token exactly like the shared token", async () => {
    process.env.TALLYHAND_API_TOKEN = SHARED;
    const secret = await createApiToken("user_1", "cli");
    expect(await requireApiToken(reqWith(secret.token))).toBeNull();
  });

  it("accepts a personal token even when the shared token is unset", async () => {
    delete process.env.TALLYHAND_API_TOKEN;
    const secret = await createApiToken("user_1", "cli");
    expect(await requireApiToken(reqWith(secret.token))).toBeNull();
  });

  it("rejects a revoked personal token", async () => {
    process.env.TALLYHAND_API_TOKEN = SHARED;
    const { revokeApiToken } = await import("@/lib/auth/api-tokens");
    const secret = await createApiToken("user_1", "cli");
    expect(await requireApiToken(reqWith(secret.token))).toBeNull();
    await revokeApiToken("user_1", secret.id);
    const res = await requireApiToken(reqWith(secret.token));
    expect(res?.status).toBe(401);
  });
});
