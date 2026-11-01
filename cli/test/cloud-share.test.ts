import { afterEach, expect, it, vi } from "vitest";
import { TallyhandClient } from "../src/client.js";
import { buildProgram } from "../src/cli.js";
import { createMcpServer } from "../src/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const input = { type: "invoice", target: { invoiceId: "inv_fixture" }, expiresInDays: 30, confirmPublicSharing: true };
const link = { id: "share_fixture", url: "https://fixture.test/share/signed", pdfUrl: "https://fixture.test/share/signed/pdf", type: "invoice", expiresAt: 9999999999999 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mockApi() {
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(new URL(String(url)).pathname).toBe("/api/v1/share-links");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic");
    expect(JSON.parse(init!.body as string)).toEqual(input);
    return Response.json({ data: link }, { status: 201 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, api: new TallyhandClient({ baseUrl: "https://fixture.test", token: "synthetic", fetcher }) };
}
it("returns public invoice and PDF links through the API client", async () => {
  const { api } = mockApi();
  expect(await api.createShare(input)).toEqual(link);
});
it("generates a cloud link from the CLI with explicit public-sharing approval", async () => {
  const { fetcher } = mockApi();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await buildProgram().parseAsync(["node", "tally", "--api-url", "https://fixture.test", "--token", "synthetic", "--json", "share", "create", "--input", JSON.stringify({ type: input.type, target: input.target, expiresInDays: 30 }), "--confirm-public-sharing"]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0][0])).toEqual(link);
});
it("generates a cloud link over the MCP wire using the same authenticated REST endpoint", async () => {
  const { api, fetcher } = mockApi();
  const server = createMcpServer(api);
  const client = new Client({ name: "cloud-share-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const result = await client.callTool({ name: "create_share_link", arguments: input });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result)).toContain(link.url);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await client.close(); await server.close(); }
});
