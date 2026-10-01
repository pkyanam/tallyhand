import { describe, it, expect } from 'vitest';
import { compareToolCatalog, inspectMcpCatalog } from '../src/mcp-catalog.js';
import { RELEASE_VERSION } from '../src/version.js';
import { VERSION } from '../src/commands.js';
import { MCP_VERSION } from '../src/mcp.js';
import { readFileSync } from 'node:fs';

describe('release diagnostics', () => {
  it('preserves top-level auth descriptors across the complete bundled catalog', async () => {
    const catalog = await inspectMcpCatalog();
    expect(catalog.total).toBe(86);
    expect(catalog.tools).toHaveLength(86);
    expect(new Set(catalog.tools.map(tool => tool.name)).size).toBe(86);
    for (const tool of catalog.tools) {
      expect(tool.securitySchemes, tool.name).toEqual(tool._meta?.securitySchemes);
      expect(tool.securitySchemes, tool.name).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'oauth2', scopes: expect.arrayContaining(['tally:read']) }),
      ]));
    }
    const settings = catalog.tools.find(tool => tool.name === 'update_settings')!;
    expect(settings.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['tally:read', 'tally:write'] }]);
  });
  it('reports missing tools without echoing private export fields', () => {
    expect(compareToolCatalog(['get_settings', 'update_settings'], { tools: [{ name: 'get_settings', description: 'private' }] }))
      .toEqual({ expected: 2, observed: 1, missing: ['update_settings'], unexpected: [], duplicateNames: 0 });
  });
  it('accepts a JSON-RPC catalog and reports duplicates and unexpected tools', () => {
    expect(compareToolCatalog(['get_settings'], { result: { tools: [{ name: 'old_tool' }, { name: 'old_tool' }] } }))
      .toEqual({ expected: 1, observed: 1, missing: ['get_settings'], unexpected: ['old_tool'], duplicateNames: 1 });
    expect(compareToolCatalog(['get_settings'], ['get_settings']).missing).toEqual([]);
  });
  it('rejects unrelated or malformed account exports', () => {
    for (const input of [null, {}, { tools: 'hello' }, [null], [3], [{ name: '<secret>' }]])
      expect(() => compareToolCatalog([], input)).toThrow();
  });
  it('keeps CLI, server and package versions synchronized', () => {
    expect(VERSION).toBe(RELEASE_VERSION);
    expect(MCP_VERSION).toBe(RELEASE_VERSION);
    for (const path of ['../../cli/package.json', '../../plugins/tallyhand/plugin.json', '../../plugins/tallyhand/.codex-plugin/plugin.json'])
      expect(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).version).toBe(RELEASE_VERSION);
  });
});
