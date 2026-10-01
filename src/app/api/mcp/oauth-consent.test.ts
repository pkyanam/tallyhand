import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/oauth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth/oauth")>();
  return { ...actual, verifyTallyOAuth: vi.fn(async () => ({ userId: "user_fixture", clientId: "client_fixture", scopes: ["tally:read"], expiresAt: Date.now() / 1000 + 600 })) };
});
import { POST } from "./route";
beforeEach(() => { vi.stubEnv("APP_BASE_URL", "https://tally.example"); });
afterEach(() => vi.unstubAllEnvs());
function request(method: string, params: Record<string, unknown>, modern = false) {
  return new Request("https://tally.example/api/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer oat_synthetic_fixture",
    ...(modern ? { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, "Mcp-Name": String(params.name ?? "") } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, ...(modern ? { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } } } : {}) } }) });
}
async function payload(res: Response) {
  const text = await res.text();
  return JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find(line => line.startsWith("data: "))!.slice(6) : text);
}
describe("OAuth scope-upgrade compatibility", () => {
  it("returns a legacy tool-level consent challenge without doing the write", async () => {
    const res = await POST(request("tools/call", { name: "update_settings", arguments: { patch: {} } }));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.result.isError).toBe(true);
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain('scope="tally:read tally:write"');
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain('error="insufficient_scope"');
  });
  it("preserves modern HTTP scope challenges and the mandatory base scope", async () => {
    const res = await POST(request("tools/call", { name: "update_settings", arguments: { patch: {} } }, true));
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("tally:read tally:write");
  });
  it("advertises precise tool scopes for all 86 tools", async () => {
    const res = await POST(request("tools/list", {}));
    const body = await payload(res);
    expect(body.result.tools).toHaveLength(86);
    for (const tool of body.result.tools) expect(tool._meta.securitySchemes[0].scopes).toContain("tally:read");
    expect(body.result.tools.find((tool: { name: string }) => tool.name === "update_settings")._meta.securitySchemes[0].scopes).toEqual(["tally:read", "tally:write"]);
    expect(body.result.tools.find((tool: { name: string }) => tool.name === "reset_workspace")._meta.securitySchemes[0].scopes).toEqual(["tally:read", "tally:manage"]);
  });
});
