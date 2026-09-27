import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { tempDbPath } from "@/server/sqlite-provider";

vi.mock("@/lib/auth/session", () => ({
  tryResolveUserId: vi.fn(async () => "local"),
}));

import { withIdempotency } from "./idempotency";

const envBefore = { ...process.env };
let dbPath = "";

function req() {
  return new Request("http://localhost/api", { method: "POST", headers: { "Idempotency-Key": "sqlite-key" } });
}

function response(status = 201, body = '{"ok":true}') {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("withIdempotency local SQLite", () => {
  beforeEach(() => {
    process.env = { ...envBefore };
    process.env.TALLY_STORAGE = "sqlite";
    dbPath = tempDbPath("tallyhand-idempotency-local");
    process.env.TALLYHAND_DB_PATH = dbPath;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...envBefore };
    try { rmSync(dbPath, { force: true }); } catch {}
  });

  it("replays a real SQLite response and stores the namespaced key", async () => {
    const handler = vi.fn(async () => response(202, '{"saved":1}'));
    const first = await withIdempotency(req(), handler);
    const second = await withIdempotency(req(), handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.text()).toBe('{"saved":1}');

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT key, status, body FROM idempotency_keys").get() as { key: string; status: number; body: string };
      expect(row).toEqual({ key: "local:sqlite-key", status: 202, body: '{"saved":1}' });
    } finally {
      db.close();
    }
  });

  it("fails open on an unwritable database path", async () => {
    process.env.TALLYHAND_DB_PATH = "/proc/self/status/tallyhand.db";
    const handler = vi.fn(async () => response());
    const result = await withIdempotency(req(), handler);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('{"ok":true}');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
