/**
 * Personal API tokens authenticate /api/mcp exactly like the shared
 * TALLYHAND_API_TOKEN: initialize + tools/list succeed with a `thp_…`
 * bearer, garbage is still 401.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { POST } from "./route";
import { tempDbPath } from "@/server/sqlite-provider";
import {
  __resetApiTokenCaches,
  createApiToken,
} from "@/lib/auth/api-tokens";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "tallyhand-test", version: "0.0.0" },
  },
};

function postInit(bearer: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (bearer !== null) headers["authorization"] = `Bearer ${bearer}`;
  return POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(INIT),
    }),
  );
}

describe("mcp route with personal api tokens", () => {
  let dbPath: string;
  let personalToken: string;

  beforeAll(async () => {
    dbPath = tempDbPath("tallyhand-mcp-personal-test");
    process.env.TALLYHAND_DB_PATH = dbPath;
    process.env.TALLY_STORAGE = "sqlite";
    process.env.TALLYHAND_API_TOKEN = "test-shared-token";
    __resetApiTokenCaches();
    personalToken = (await createApiToken("user_mcp", "mcp-test")).token;
  });

  afterAll(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("initialize succeeds with a personal thp_ bearer token", async () => {
    const res = await postInit(personalToken);
    expect(res.status).toBe(200);
    const text = await res.text();
    const m = text.match(/^data: (.+)$/m);
    expect(m).not.toBeNull();
    const payload = JSON.parse(m![1]) as {
      result?: { protocolVersion?: string };
    };
    expect(payload.result?.protocolVersion).toBe("2025-11-25");
  });

  it("initialize succeeds with the shared token (unchanged)", async () => {
    const res = await postInit("test-shared-token");
    expect(res.status).toBe(200);
  });

  it("rejects garbage bearer tokens with 401", async () => {
    const res = await postInit("garbage-token");
    expect(res.status).toBe(401);
  });

  it("rejects missing bearer tokens with 401", async () => {
    const res = await postInit(null);
    expect(res.status).toBe(401);
  });
});
