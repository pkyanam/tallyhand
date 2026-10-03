"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
type App = { id: string; name: string; clientId: string; public: boolean; scopes: string[]; redirectUris: string[]; clientSecret?: string };
const callback = 'https://v2.executor.sh/api/oauth/callback';
const choices = [
  ['tally:read', 'Read workspace data'],
  ['tally:write', 'Create and edit records'],
  ['tally:manage', 'Delete records, send invoices, mark paid, and manage public shares'],
  ['offline_access', 'Keep the connection through refresh tokens'],
] as const;
export function OAuthClientsCard() {
  const [apps, setApps] = useState<App[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Executor');
  const [redirect, setRedirect] = useState(callback);
  const [isPublic, setPublic] = useState(false);
  const [scopes, setScopes] = useState<string[]>(['tally:read', 'offline_access']);
  const [issued, setIssued] = useState<App | null>(null);
  async function request(path: string, init?: RequestInit) {
    const res = await fetch(path, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
    const body = await res.json();
    if (!res.ok) throw new Error([body.error?.message ?? 'Request failed', ...(body.error?.details ?? []).map((d: { field: string; reason: string }) => `${d.field}: ${d.reason}`)].join(' '));
    return body;
  }
  async function refresh() {
    setLoading(true);
    try { setApps((await request('/api/v1/oauth-clients')).data); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load clients.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete request.'); }
    finally { setBusy(false); }
  }
  return <Card id="oauth-clients">
    <CardHeader><CardTitle>OAuth applications</CardTitle><CardDescription>Connect Executor and other applications without sharing your Tallyhand password or personal API key.</CardDescription></CardHeader>
    <CardContent className="space-y-5 text-sm">
      <p>Register an application, copy its client ID into the connecting service, then sign in and review consent. Registration does not grant access to anyone’s account. Each user authorizes their own workspace.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void refresh()}>{loading ? 'Loading clients…' : 'Refresh clients'}</Button>
      {issued && <div role="status" className="space-y-2 rounded-lg border-2 p-4">
        <p className="font-semibold">{issued.name}: save these details in your application</p>
        <Label htmlFor="issued-client-id">Client ID</Label><Input id="issued-client-id" readOnly value={issued.clientId} />
        {issued.clientSecret && <><Label htmlFor="issued-client-secret">Client secret (shown only for this operation)</Label><Input id="issued-client-secret" type="password" readOnly autoComplete="off" value={issued.clientSecret} /><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(issued.clientSecret!).catch(() => setError('Clipboard unavailable. Select and copy the secret field manually.')); }}>Copy client secret</Button><p>Keep it on the connecting service’s server. Never put it in a browser app, source repository or chat.</p></>}
        {issued.public && <p>Public client: leave the secret blank and use authorization code with S256 PKCE.</p>}
        <Button variant="outline" onClick={() => setIssued(null)}>Hide details</Button>
      </div>}
      <ul className="space-y-3">{apps.map(app => <li key={app.id} className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">{app.name}</p><p className="break-all font-mono text-xs">{app.clientId}</p>
        <p>{app.public ? 'Public · PKCE' : 'Confidential · secret + PKCE'}</p><p>{app.scopes.join(' ')}</p>
        {app.redirectUris.map(uri => <p key={uri} className="break-all text-muted-foreground">{uri}</p>)}
        <div className="flex flex-wrap gap-2">{!app.public && <Button variant="outline" size="sm" disabled={busy} onClick={() => {
          if (window.confirm('Rotate this client secret? Existing applications must be updated to the replacement secret.')) void run(async () => setIssued((await request(`/api/v1/oauth-clients/${app.id}`, { method: 'POST' })).data));
        }}>Rotate secret</Button>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => {
          if (window.confirm(`Delete OAuth application “${app.name}”? Connections using this client will stop working. This cannot be undone.`)) void run(async () => { await request(`/api/v1/oauth-clients/${app.id}`, { method: 'DELETE' }); if (issued?.id === app.id) setIssued(null); });
        }}>Delete client</Button></div>
      </li>)}</ul>
      <form className="space-y-3 border-t pt-4" onSubmit={e => { e.preventDefault(); if (!window.confirm(`Create “${name}” with allowed scopes ${scopes.join(', ')}? Users will still need to consent in the connecting app.`)) return; void run(async () => { setIssued((await request('/api/v1/oauth-clients', { method: 'POST', body: JSON.stringify({ name, redirectUris: redirect.split('\n').map(s => s.trim()).filter(Boolean), scopes, public: isPublic }) })).data); }); }}>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => { setName('Executor'); setRedirect(callback); setPublic(false); }}>Executor preset</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setScopes(choices.map(([scope]) => scope))}>Select full workspace access</Button></div>
        <Label htmlFor="oauth-app-name">Application name</Label><Input id="oauth-app-name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} />
        <Label htmlFor="oauth-redirects">Exact HTTPS callback URLs (one per line)</Label><textarea id="oauth-redirects" required rows={3} className="w-full rounded-md border bg-background p-3" value={redirect} onChange={e => setRedirect(e.target.value)} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)} />Public client: browser/native app that cannot keep a secret</label>
        <fieldset className="space-y-2"><legend className="mb-2 font-medium">Allowed permissions</legend>{choices.map(([scope, label]) => <label key={scope} className="flex items-start gap-2"><input type="checkbox" disabled={scope === 'tally:read'} checked={scopes.includes(scope)} onChange={e => setScopes(old => e.target.checked ? [...old, scope] : old.filter(s => s !== scope))} /><span>{label} <code className="text-xs">({scope})</code></span></label>)}</fieldset>
        <p className="text-muted-foreground">Full access includes consequential bookkeeping actions. It does not execute bank transfers or grant account-administration access.</p>
        <Button type="submit" disabled={busy || loading || apps.length >= 10}>{busy ? 'Saving…' : 'Create OAuth client'}</Button>
      </form>
      <div className="space-y-2 rounded-lg bg-muted/40 p-4"><p className="font-medium">Executor setup</p><ol className="list-decimal space-y-1 pl-5"><li>Register the Executor preset above with the permissions you want available.</li><li>Paste the client ID and, for a confidential client, secret into Executor’s connection dialog.</li><li>For full control, Executor must request <code>tally:read tally:write tally:manage offline_access</code> in its OAuth provider configuration. Its required-permissions display may initially show only read and offline access.</li><li>Connect, sign in and approve those requested permissions. If an existing grant is read-only, reconnect with the expanded scope request.</li></ol><p>Resource/audience: <code>https://tallyhand.xyz/api/mcp</code>. For self-hosted deployments, use that deployment’s MCP URL instead. Do not disable audience validation to make a client work.</p><p><a className="underline" href="/docs/integrations">Integration guide and troubleshooting</a></p></div>
    </CardContent>
  </Card>;
}
