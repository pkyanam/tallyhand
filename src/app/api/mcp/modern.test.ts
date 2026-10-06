import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "./route";
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer synthetic-mcp-test-key", "MCP-Protocol-Version": "2026-07-28" };
beforeEach(() => { vi.stubEnv("TALLYHAND_API_TOKEN", "synthetic-mcp-test-key"); vi.stubEnv("APP_BASE_URL", "http://localhost:3000"); });
afterEach(() => vi.unstubAllEnvs());
function request(method: string, params: Record<string, unknown> = {}, extraHeaders = {}) {
  return new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { ...headers, "Mcp-Method": method, ...extraHeaders }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } } } }) });
}
describe("July 2026 MCP HTTP", () => {
  it("discovers without an initialize handshake", async () => {
    const r = await POST(request("server/discover"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.result.resultType).toBe("complete");
    expect(JSON.stringify(body.result)).toContain("2026-07-28");
    expect(JSON.stringify(body.result)).toContain("https://tallyhand.xyz/brand/icon-192.png");
  });
  it("returns modern cache hints and structured tool definitions", async () => {
    const r = await POST(request("tools/list"));
    expect(r.status).toBe(200);
    const { result } = await r.json();
    expect(result.resultType).toBe("complete");
    expect(result.cacheScope).toBe("private");
    expect(result.ttlMs).toBe(300000);
    expect(result.tools.find((t: { name: string }) => t.name === "reset_workspace").annotations.destructiveHint).toBe(true);
    expect(result.tools.every((t: { outputSchema?: unknown }) => !!t.outputSchema)).toBe(true);
    expect(result.tools).toHaveLength(91);
    for (const tool of result.tools) expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
  });
  it("validates required metadata headers", async () => {
    const r = await POST(request("tools/list", {}, { "Mcp-Method": "resources/list" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32020);
  });
  it("publishes OAuth discovery in the authentication challenge", async () => {
    const req = request("server/discover"); req.headers.delete("authorization");
    const r = await POST(req);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp");
  });
  it("rejects unapproved browser origins", async () => {
    const r = await POST(request("tools/list", {}, { origin: "https://unapproved.example" }));
    expect(r.status).toBe(403);
  });
  it("does not open the removed GET stream", async () => {
    const r = await GET(new Request("http://localhost:3000/api/mcp", { headers }));
    expect(r.status).toBe(405);
  });
});

 it("publishes server icons in legacy initialize", async () => {
    const r = await POST(new Request("http://localhost:3000/api/mcp", {method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",authorization:"Bearer synthetic-mcp-test-key"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"fixture",version:"1"}}})}));
    const result = (await r.json()).result;
    expect(result.serverInfo.icons).toEqual([{src:"https://tallyhand.xyz/brand/icon-192.png",mimeType:"image/png",sizes:["192x192"]}]);
 });
