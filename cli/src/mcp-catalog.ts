/** Inspect the bundled server without loading credentials or making network calls. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, MCP_VERSION } from './mcp.js';
import { TallyhandClient } from './client.js';
export async function inspectMcpCatalog(name?: string) {
  const api = new TallyhandClient({ baseUrl: 'https://example.invalid/api/v1' });
  const server = createMcpServer(api);
  const client = new Client({ name: 'tallyhand-catalog', version: MCP_VERSION });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const { tools } = await client.listTools();
    const selected = name ? tools.filter(tool => tool.name === name) : tools;
    if (!selected.length) throw new Error(`Unknown bundled tool: ${name}`);
    return { source: 'bundled CLI, not host approval state', version: MCP_VERSION, total: tools.length, tools: selected };
  } finally { await client.close(); await server.close(); }
}
