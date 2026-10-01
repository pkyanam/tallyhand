import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/auth/oauth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/oauth")>(),
  verifyTallyOAuth: verify,
}));
import { POST } from "./route";

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://tally.example");
  verify.mockResolvedValue({ userId: "user_catalog_fixture", clientId: "client_fixture", scopes: ["tally:read", "tally:write", "tally:manage"] });
});
afterEach(() => vi.unstubAllEnvs());

function request(method: string, params: Record<string, unknown>, version: string, progress = false) {
  const modern = version === "2026-07-28";
  return new Request("https://tally.example/api/mcp", {
    method: "POST",
    headers: { authorization: "Bearer oat_catalog_fixture", "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": version,
      ...(modern ? { "Mcp-Method": method, ...(params.name ? { "Mcp-Name": String(params.name) } : {}) } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params,
      ...(modern || progress ? { _meta: {
        ...(modern ? { "io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "catalog-fixture", version: "1" } } : {}),
        ...(progress ? { progressToken: "fixture-progress" } : {}),
      } } : {}),
    } }),
  });
}
async function rpc(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).find(value => value.id === 1);
  }
  return JSON.parse(text);
}

describe("complete MCP catalog and settings dispatch", () => {
  for (const version of ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"]) {
    for (const progress of [false, true]) {
      it(`returns all 86 tools and all 12 update tools over ${version}, progress=${progress}`, async () => {
        const response = await POST(request("tools/list", {}, version, progress));
        expect(response.status).toBe(200);
        const { result } = await rpc(response);
        const names = result.tools.map((tool: { name: string }) => tool.name);
        expect(new Set(names).size).toBe(86);
        expect(names.filter((name: string) => name.startsWith("update_"))).toHaveLength(12);
        expect(names).toContain("update_settings");
        expect(result.nextCursor).toBeUndefined();
        expect(response.headers.get("cache-control")).toContain("no-store");
      });
    }
    it(`dispatches documented settings dry-run through the real REST handler over ${version}`, async () => {
      const patch = { business: { name: "Example Contractor", email: "fixture@example.com", paymentInstructions: "Direct Deposit" }, invoice: { paymentTermsDays: 30, defaultPaymentMethod: "Direct Deposit" } };
      const response = await POST(request("tools/call", { name: "update_settings", arguments: { patch, dryRun: true } }, version));
      expect(response.status).toBe(200);
      const { result } = await rpc(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.data).toMatchObject({ dryRun: true, valid: true, patch });
    });
  }
  it("returns the same catalog for read-only and write-enabled OAuth grants", async () => {
    const full = await rpc(await POST(request("tools/list", {}, "2025-11-25")));
    verify.mockResolvedValue({ userId: "user_catalog_fixture", clientId: "client_fixture", scopes: ["tally:read"] });
    const readOnly = await rpc(await POST(request("tools/list", {}, "2025-11-25")));
    expect(readOnly.result.tools).toEqual(full.result.tools);
  });
});
