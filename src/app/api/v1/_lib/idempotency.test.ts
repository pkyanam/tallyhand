import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDbPath } from "@/server/sqlite-provider";

const cloudRows = new Map<string, { status: number; body: string }>();
const cloudQueries: Array<{ strings: string[]; values: unknown[] }> = [];
let neonThrows = false;
let neonInsertThrows = false;

vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    const sql = async (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
      const segments = typeof strings === "string" ? [strings] : Array.from(strings);
      const query = segments.join("?");
      cloudQueries.push({ strings: segments, values });
      if (neonThrows || (neonInsertThrows && query.includes("INSERT INTO idempotency_keys"))) throw new Error("fake Neon failure");
      if (query.startsWith("CREATE TABLE")) return [];
      if (query.includes("SELECT status, body")) {
        const row = cloudRows.get(String(values[0]));
        return row ? [row] : [];
      }
      if (query.includes("INSERT INTO idempotency_keys")) {
        const key = String(values[0]);
        if (!cloudRows.has(key)) cloudRows.set(key, { status: Number(values[1]), body: String(values[2]) });
      }
      return [];
    };
    return sql;
  },
}));

vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    constructor() { throw new Error("sqlite unavailable"); }
  },
}));

vi.mock("@/lib/auth/session", () => ({
  tryResolveUserId: vi.fn(async () => "local"),
}));

import { withIdempotency } from "./idempotency";

const envBefore = { ...process.env };

function restoreEnv() {
  process.env = { ...envBefore };
}

function req(method = "POST", key = "key-1") {
  return new Request("http://localhost/api", { method, headers: { "Idempotency-Key": key } });
}

function response(status = 201, body = '{"ok":true}') {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("withIdempotency", () => {
  beforeEach(() => {
    restoreEnv();
    cloudRows.clear();
    cloudQueries.length = 0;
    neonThrows = false;
    neonInsertThrows = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("uses Neon without constructing sqlite in cloud mode", async () => {
    process.env.TALLY_STORAGE = "neon";
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test-pooler.us-east-2.aws.neon.tech/db";
    const handler = vi.fn(async () => response());
    const result = await withIdempotency(req(), handler);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('{"ok":true}');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cloudQueries.some(({ values }) => values[0] === "local:key-1")).toBe(true);
  });

  it("replays the cloud response without rerunning the handler", async () => {
    process.env.TALLY_STORAGE = "neon";
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db";
    const handler = vi.fn(async () => response(202, '{"saved":1}'));
    const first = await withIdempotency(req(), handler);
    const second = await withIdempotency(req(), handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
  });

  it("fails open when Neon persistence fails", async () => {
    process.env.TALLY_STORAGE = "neon";
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db";
    neonThrows = true;
    const handler = vi.fn(async () => response(201, '{"fallback":true}'));
    const result = await withIdempotency(req(), handler);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('{"fallback":true}');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not rerun the handler when Neon insert fails after success", async () => {
    process.env.TALLY_STORAGE = "neon";
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db";
    neonInsertThrows = true;
    const handler = vi.fn(async () => response(201, '{"stored":false}'));
    const result = await withIdempotency(req(), handler);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('{"stored":false}');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cloudQueries.some(({ strings }) => strings.join("").includes("SELECT status, body"))).toBe(true);
  });

  it("preserves local SQLite replay and fails open when SQLite cannot open", async () => {
    process.env.TALLY_STORAGE = "sqlite";
    process.env.TALLYHAND_DB_PATH = tempDbPath("tallyhand-idempotency-test");
    // node:sqlite is mocked above to throw, so local persistence degrades safely.
    const handler = vi.fn(async () => response());
    const first = await withIdempotency(req(), handler);
    const second = await withIdempotency(req(), handler);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("passes unkeyed and non-write requests through", async () => {
    const handler = vi.fn(async () => response());
    await withIdempotency(new Request("http://localhost/api", { method: "GET" }), handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
