/** CLI-owned, read-only MCP interoperability check. Never logs credentials. */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CLI_MCP_PARITY } from "./mcp-parity.js";
import type { ResolvedConfig } from "./client.js";

export async function checkMcp(config: ResolvedConfig, opts: { transport?: string; protocol?: string; workspace?: boolean }) {
  const modern = opts.protocol !== "legacy";
  const client = new Client({ name: "tallyhand-cli-check", version: "0.2.0" }, {
    versionNegotiation: { mode: modern ? { pin: "2026-07-28" } : "legacy" },
    capabilities: { elicitation: { form: {} } },
  });
  client.setRequestHandler("elicitation/create", async () => ({ action: "decline" }));
  const target = new URL(config.baseUrl);
  target.pathname = "/api/mcp"; target.search = ""; target.hash = "";
  const transport = opts.transport === "stdio"
    ? new StdioClientTransport({ command: process.execPath, args: [process.argv[1], "mcp"], env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")), stderr: "pipe" })
    : new StreamableHTTPClientTransport(target, { requestInit: { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} } });
  let stage = "connect";
  try {
    await client.connect(transport);
    stage = "tool catalog";
    const tools = await client.listTools();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    const guide = await client.readResource({ uri: "tally://guide" });
    const health = await client.callTool({ name: "health_check", arguments: {} });
    if (health.isError) throw new Error(`MCP health tool failed: ${JSON.stringify(health.content)}`);
    for (const tool of tools.tools) {
      const schemes = tool._meta?.securitySchemes as Array<{ scopes?: string[] }> | undefined;
      if (!schemes?.[0]?.scopes?.includes("tally:read")) throw new Error(`Missing OAuth policy for ${tool.name}`);
    }
    const missing = Object.values(CLI_MCP_PARITY).filter(name => !tools.tools.some(tool => tool.name === name));
    if (missing.length) throw new Error(`Missing MCP tools: ${missing.join(", ")}`);
    stage = "elicitation";
    if (modern) {
      const form = await client.callTool({ name: "export_data", arguments: {} });
      if (form.isError || !(form.structuredContent as { data?: { cancelled?: boolean } })?.data?.cancelled) throw new Error("MCP form-elicitation cancellation did not complete safely");
    }
    stage = "workspace reads";
    if (opts.workspace) {
      const settings = await client.callTool({ name: "get_settings", arguments: {} });
      if (settings.isError) throw new Error("Authenticated MCP settings read failed");
      await client.readResource({ uri: "tally://workspace/settings" });
      await client.getPrompt({ name: "weekly_review", arguments: {} });
      stage = "prompt completion";
      await client.complete({ ref: { type: "ref/prompt", name: "weekly_review" }, argument: { name: "clientId", value: "" } });
    }
    console.log(JSON.stringify({ ok: true, transport: opts.transport ?? "http", protocol: modern ? "2026-07-28" : "legacy", tools: tools.tools.length, resources: resources.resources.length, resourceTemplates: templates.resourceTemplates.length, prompts: prompts.prompts.length, guide: guide.contents.length > 0, elicitation: modern ? "declined safely" : "not exercised", workspace: !!opts.workspace }, null, 2));
  } catch (error) { throw new Error(`${stage}: ${error instanceof Error ? error.message : "MCP check failed"}`); }
  finally { await client.close(); }
}
