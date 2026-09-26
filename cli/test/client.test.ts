import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TallyhandClient, ApiError, resolveConfig } from "../src/client.js";

function mockFetch(handler: (url: URL, init: any) => any) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (input: any, init: any = {}) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
    calls.push({ url: url.toString(), init });
    const body = handler(url, init);
    return {
      ok: body.status < 400,
      status: body.status,
      statusText: body.statusText ?? "",
      text: async () => (typeof body.json === "string" ? body.json : JSON.stringify(body.json)),
      json: async () => body.json,
    };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TALLYHAND_API_URL;
  delete process.env.TALLYHAND_API_TOKEN;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL normalization", () => {
  it("appends /api/v1 when missing", () => {
    expect(new TallyhandClient({ baseUrl: "http://localhost:3000" }).baseUrl).toBe(
      "http://localhost:3000/api/v1",
    );
  });
  it("strips trailing slashes and keeps existing /api/v1", () => {
    expect(new TallyhandClient({ baseUrl: "http://x:3000/api/v1/" }).baseUrl).toBe(
      "http://x:3000/api/v1",
    );
  });
});

describe("auth + errors", () => {
  it("sends Authorization: Bearer when token set", async () => {
    const { calls } = mockFetch(() => ({ status: 200, json: { data: { status: "ok" } } }));
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "sekret" });
    await c.health();
    expect(calls[0].init.headers["Authorization"]).toBe("Bearer sekret");
  });

  it("omits Authorization when no token", async () => {
    const { calls } = mockFetch(() => ({ status: 200, json: { data: { status: "ok" } } }));
    const c = new TallyhandClient({ baseUrl: "http://test.local" });
    await c.health();
    expect(calls[0].init.headers["Authorization"]).toBeUndefined();
  });

  it("maps {error:{code,message}} bodies to ApiError", async () => {
    mockFetch(() => ({
      status: 401,
      json: { error: { code: "unauthorized", message: "bad token" } },
    }));
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "x" });
    const err = await c.listClients().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
    expect(err.message).toBe("bad token");
  });

  it("adds Idempotency-Key on POST", async () => {
    const { calls } = mockFetch(() => ({ status: 200, json: { data: { id: "1" } } }));
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "x" });
    await c.createClient({ name: "Acme" });
    const key = calls[0].init.headers["Idempotency-Key"];
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(10);
  });

  it("does not add Idempotency-Key on GET", async () => {
    const { calls } = mockFetch(() => ({ status: 200, json: { data: [] } }));
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "x" });
    await c.listClients();
    expect(calls[0].init.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("unwraps the {data} envelope", async () => {
    mockFetch(() => ({ status: 200, json: { data: [{ id: "c1" }], meta: {} } }));
    const c = new TallyhandClient({ baseUrl: "http://test.local" });
    expect(await c.listClients()).toEqual([{ id: "c1" }]);
  });
});

describe("pagination auto-follow", () => {
  it("follows cursor until null when all:true", async () => {
    mockFetch((url) => {
      const cursor = url.searchParams.get("cursor");
      if (!cursor)
        return { status: 200, json: { data: [{ id: "a" }], meta: { nextCursor: "c2", limit: 200 } } };
      return { status: 200, json: { data: [{ id: "b" }], meta: { nextCursor: null, limit: 200 } } };
    });
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "x" });
    const items = (await c.listClients({ all: true })) as any[];
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("single page without all:true", async () => {
    const { calls } = mockFetch(() => ({
      status: 200,
      json: { data: [{ id: "a" }], meta: { page: { cursor: "c2", limit: 50 } } },
    }));
    const c = new TallyhandClient({ baseUrl: "http://test.local", token: "x" });
    const res = await c.listClients();
    expect(res).toEqual([{ id: "a" }]);
    expect(calls).toHaveLength(1);
  });
});

describe("resolveConfig", () => {
  it("prefers flags > env > file > default", async () => {
    const { resolveConfig: rc } = await import("../src/client.js");
    process.env.TALLYHAND_API_URL = "http://env:4000";
    // flags win
    expect(rc({ apiUrl: "http://flag:1" }).baseUrl).toBe("http://flag:1");
    // env wins over default
    expect(rc({}).baseUrl).toBe("http://env:4000");
    delete process.env.TALLYHAND_API_URL;
    // default
    expect(rc({}).baseUrl).toBe("http://localhost:3000");
    expect(rc({}).token).toBeUndefined();
  });

  it("picks up token from env", () => {
    process.env.TALLYHAND_API_TOKEN = "tok123";
    expect(resolveConfig({}).token).toBe("tok123");
  });
});
