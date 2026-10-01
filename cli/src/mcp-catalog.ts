/** Inspect the bundled server without loading credentials or making network calls. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMcpServer, MCP_VERSION } from './mcp.js';
import { TallyhandClient } from './client.js';
/** Accept exported tool names or a tools/list response; never print unrelated data. */
export function compareToolCatalog(expected: string[], observed: unknown) {
  const value = observed as { tools?: unknown; result?: { tools?: unknown } } | null;
  const items = Array.isArray(observed) ? observed : value?.tools ?? value?.result?.tools;
  if (!Array.isArray(items) || items.length > 10000) throw new Error('Expected a JSON array of tool names, {tools: [...]}, or {result: {tools: [...]}}');
  const names = items.map(item => typeof item === 'string' ? item : item?.name);
  if (names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(name))) throw new Error('Each tool must have a valid, unprefixed MCP tool name');
  const actual = new Set<string>(names);
  const wanted = new Set(expected);
  return { expected: wanted.size, observed: actual.size, missing: [...wanted].filter(name => !actual.has(name)).sort(), unexpected: [...actual].filter(name => !wanted.has(name)).sort(), duplicateNames: names.length - actual.size };
}
export async function inspectMcpCatalog(name?: string) {
  const api = new TallyhandClient({ baseUrl: 'https://example.invalid/api/v1' });
  const server = createMcpServer(api);
  const client = new Client({ name: 'tallyhand-catalog', version: MCP_VERSION });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    // The SDK's default tool parser strips descriptor extensions such as
    // OpenAI's top-level securitySchemes. Keep them in diagnostic output while
    // still validating the standard MCP descriptor fields.
    const { tools } = await client.request({ method: 'tools/list' },
      ListToolsResultSchema.extend({ tools: z.array(ToolSchema.passthrough()) }));
    const selected = name ? tools.filter(tool => tool.name === name) : tools;
    if (!selected.length) throw new Error(`Unknown bundled tool: ${name}`);
    return { source: 'bundled CLI, not host approval state', version: MCP_VERSION, total: tools.length, tools: selected };
  } finally { await client.close(); await server.close(); }
}
