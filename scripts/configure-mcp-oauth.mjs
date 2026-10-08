/** Opt-in deployment maintenance. Credentials remain inside the build environment. */
export const workspaceScopes = ['tally:read', 'tally:write', 'tally:manage', 'offline_access'];
const trustedHosts = ['cursor.com', 'grok.com', 'x.ai'];
const scopesOf = value => Array.isArray(value) ? value : String(value ?? '').split(/\s+/).filter(Boolean);
/** @param {string | undefined} key @param {(input: string, init: RequestInit) => Promise<Response>} fetcher */
export async function configureMcpOAuth(key, fetcher = fetch) {
  if (!key || !key.startsWith('sk_live_')) throw new Error('Production Clerk credential is required');
  const request = async (path, method = 'GET', body) => {
    const response = await fetcher(`https://api.clerk.com/v1/${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Clerk OAuth configuration failed (${response.status})`);
    return response.json();
  };
  const settings = await request('instance/oauth_application_settings');
  const defaults = [...new Set([...scopesOf(settings.default_scopes), ...workspaceScopes])];
  const updated = await request('instance/oauth_application_settings', 'PATCH', { default_scopes: defaults, pkce_required: true });
  if (workspaceScopes.some(scope => !scopesOf(updated.default_scopes).includes(scope)) || updated.pkce_required !== true)
    throw new Error('Clerk did not confirm MCP defaults and PKCE');
  let offset = 0, count = 0, updatedClients = 0;
  do {
    const page = await request(`oauth_applications?limit=100&offset=${offset}`);
    if (!Array.isArray(page.data)) throw new Error('Invalid Clerk OAuth application list');
    for (const app of page.data) {
      const current = scopesOf(app.scopes);
      // Update only existing workspace integrations with exact trusted host callbacks.
      // Manually restricted third-party clients and their grants remain owner-controlled.
      const trusted = current.includes('tally:read') && app.redirect_uris?.length > 0 && app.redirect_uris.every(uri => {
        try { const url = new URL(uri); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && trustedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); }
        catch { return false; }
      });
      if (!trusted || workspaceScopes.every(scope => current.includes(scope))) continue;
      const result = await request(`oauth_applications/${encodeURIComponent(app.id)}`, 'PATCH', {
        scopes: [...new Set([...current, ...workspaceScopes])].join(' '), consent_screen_enabled: true, pkce_required: true,
      });
      if (workspaceScopes.some(scope => !scopesOf(result.scopes).includes(scope)) || result.consent_screen_enabled !== true || result.pkce_required !== true)
        throw new Error('Clerk did not confirm connector scope eligibility and consent');
      updatedClients++;
    }
    count += page.data.length; offset += 100;
    if (offset > 10000) throw new Error('OAuth application pagination exceeded maintenance limit');
    if (page.data.length < 100) break;
  } while (true);
  return { defaults: scopesOf(updated.default_scopes), pkceRequired: true, inspectedClients: count, updatedClients };
}
if (process.env.TALLY_CONFIGURE_MCP_OAUTH === 'true') {
  try { console.log('MCP OAuth configuration verified:', JSON.stringify(await configureMcpOAuth(process.env.CLERK_SECRET_KEY))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
