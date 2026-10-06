import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { TallyhandMcpServer } from "../src/mcp-server.js";
import { settingsPatchSchema } from "../src/settings-schema.js";
import { createMcpServer } from "../src/mcp.js";
import type { Api } from "../src/commands.js";

async function wireCatalog(server: McpServer) {
  const client = new Client({ name: "wire-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  let tools: any[] = [];
  const send = st.send.bind(st);
  st.send = async (message, options) => {
    if ("result" in message && Array.isArray(message.result.tools)) tools = message.result.tools;
    return send(message, options);
  };
  try {
    await server.connect(st);
    await client.connect(ct);
    await client.listTools();
    return tools;
  } finally { await client.close(); await server.close(); }
}

describe("wire auth descriptors", () => {
  it("preserves the default SDK descriptors across the entire 91-tool catalog", async () => {
    const reference = new McpServer({ name: "reference", version: "1" });
    const original = McpServer.prototype.registerTool;
    const spy = vi.spyOn(McpServer.prototype, "registerTool").mockImplementation(function (this: McpServer, name: string, config: any, callback: any) {
      original.call(reference, name, config, callback);
      return original.call(this, name, config, callback);
    });
    let current: McpServer;
    try { current = createMcpServer(new Proxy({}, { get: () => async () => null }) as Api); }
    finally { spy.mockRestore(); }
    const [before, after] = await Promise.all([wireCatalog(reference), wireCatalog(current)]);
    expect(before).toHaveLength(91);
    expect(after).toHaveLength(91);
    for (let index = 0; index < before.length; index++) {
      const { securitySchemes, ...unchanged } = after[index];
      expect(securitySchemes).toEqual(before[index]._meta.securitySchemes);
      expect(unchanged, before[index].name).toEqual(before[index]);
    }
  });
  it("keeps the SDK schema and annotations unchanged while adding the auth mirror", async () => {
    const standard = new McpServer({ name: "standard", version: "1" });
    const extended = new TallyhandMcpServer({ name: "extended", version: "1" });
    const schemes = [{ type: "oauth2", scopes: ["tally:read", "tally:write"] }];
    const config = {
      inputSchema: z.object({ patch: settingsPatchSchema, limit: z.number().default(50) }),
      outputSchema: z.object({ data: z.unknown() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { securitySchemes: schemes, "openai/profile": true },
    };
    for (const server of [standard, extended]) server.registerTool("fixture", config, async () => ({ content: [] }));
    extended.installToolCatalog();
    const [before, after] = await Promise.all([wireCatalog(standard), wireCatalog(extended)]);
    expect(after[0].securitySchemes).toEqual(schemes);
    const { securitySchemes: _auth, ...unchanged } = after[0];
    expect(unchanged).toEqual(before[0]);
    expect(after[0]._meta["openai/profile"]).toBe(true);
  });
});
