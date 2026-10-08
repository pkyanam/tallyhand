import { expect, it, vi } from 'vitest';
import { configureMcpOAuth, workspaceScopes } from '../../../scripts/configure-mcp-oauth.mjs';
it('configures scope-omitting clients and known MCP connectors without upgrading issued tokens or unrelated clients', async () => {
  const connector = { id: 'oa_cursor', scopes: 'tally:read offline_access', redirect_uris: ['https://cursor.com/oauth/callback'] };
  const unrelated = { id: 'oa_readonly', scopes: 'tally:read', redirect_uris: ['https://other.example/callback'] };
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    const body = options.body ? JSON.parse(String(options.body)) : null;
    if (url.endsWith('oauth_application_settings')) return Response.json(body ?? {default_scopes: ['tally:read'], pkce_required: true});
    if (url.includes('oauth_applications?')) return Response.json({data: [connector, unrelated]});
    return Response.json(body);
  });
  const result = await configureMcpOAuth('sk_live_synthetic_fixture', fetcher);
  expect(result.updatedClients).toBe(1);
  expect(result.defaults).toEqual(workspaceScopes.filter(scope => scope !== 'offline_access'));
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body)).default_scopes).not.toContain('offline_access');
  const updates = fetcher.mock.calls.filter(([, options]) => options.method === 'PATCH');
  expect(updates).toHaveLength(2);
  expect(updates[1][0].endsWith('/oauth_applications/oa_cursor')).toBe(true);
  expect(JSON.parse(String(updates[1][1].body))).toMatchObject({ consent_screen_enabled: true, pkce_required: true });
  expect(fetcher.mock.calls.some(([url]) => /tokens|grants/.test(url))).toBe(false);
});
it('fails without printing the provider body if configuration cannot be confirmed', async () => {
  const fetcher = vi.fn(async () => new Response('sensitive upstream body', {status: 503}));
  await expect(configureMcpOAuth('sk_live_synthetic_fixture', fetcher)).rejects.toThrow('Clerk OAuth configuration failed: GET instance/oauth_application_settings (503)');
});
