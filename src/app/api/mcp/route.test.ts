/**
 * Remote MCP endpoint tests: exercise POST /api/mcp directly with real
 * Request objects. initialize + tools/list never touch the REST backend,
 * so no server is needed; tool *calls* would loop back over HTTP and are
 * covered by the CLI's own MCP tests.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { POST, GET } from "./route";

const TOKEN = "test-mcp-token";

beforeAll(() => {
  process.env.TALLYHAND_API_TOKEN = TOKEN;
});

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${TOKEN}`,
};

function post(body: unknown, headers: Record<string, string> = HEADERS) {
  return POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

/** Extract the JSON-RPC payload from an SSE (or plain JSON) response. */
interface RpcPayload {
  id?: number | string | null;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name?: string; version?: string };
    tools?: { name: string }[];
  };
  error?: { code: number; message: string; data?: unknown };
}

async function readRpc(res: Response): Promise<RpcPayload> {
  const text = await res.text();
  const m = text.match(/^data: (.+)$/m);
  if (m) return JSON.parse(m[1]) as RpcPayload;
  return JSON.parse(text) as RpcPayload;
}

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

describe("POST /api/mcp", () => {
  it("rejects requests without a Bearer token", async () => {
    const res = await post(INIT, {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await post(INIT, { ...HEADERS, authorization: "Bearer nope" });
    expect(res.status).toBe(401);
  });

  it("answers initialize with the tallyhand server info", async () => {
    const res = await post(INIT);
    expect(res.status).toBe(200);
    const msg = await readRpc(res);
    expect(msg.id).toBe(1);
    expect(msg.result?.serverInfo?.name).toBe("tallyhand");
    expect(typeof msg.result?.protocolVersion).toBe("string");
  });

  it("lists tools including health_check", async () => {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const msg = await readRpc(res);
    const names = (msg.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("health_check");
    expect(names).toContain("list_clients");
    expect(names.length).toBeGreaterThan(10);
  });

  it("accepts notifications without a response payload", async () => {
    const res = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect([200, 202]).toContain(res.status);
  });

  it("returns a JSON-RPC error for unknown methods", async () => {
    const res = await post({ jsonrpc: "2.0", id: 9, method: "nope/not-a-method" });
    expect(res.status).toBe(200);
    const msg = await readRpc(res);
    expect(msg.id).toBe(9);
    expect(msg.error).toBeDefined();
  });
});

describe("GET /api/mcp", () => {
  it("returns 405 for the removed standalone GET stream", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/mcp", { headers: HEADERS }),
    );
    expect(res.status).toBe(405);
    await res.body?.cancel();
  });
});
