/** Resource-bound public OAuth client. Credentials never appear in command output. */
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileConfig, writeFileConfig, CONFIG_PATH } from "./client.js";

export interface OAuthCredentials {
  origin: string; resource: string; issuer: string; clientId: string;
  tokenEndpoint: string; revocationEndpoint?: string;
  accessToken: string; refreshToken?: string; expiresAt: number; scope: string;
}
export interface AuthorizationWorkflow {
  status: "authorization_required"; authorizationUrl: string; redirectUri: string;
  expiresIn: number; instructions: string;
}
const REDIRECT = "http://127.0.0.1:43819/callback";
export function oauthOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))
    throw new Error("OAuth requires HTTPS, or a local development server");
  return url.origin;
}
export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(32).toString("base64url") };
}
export function validState(incoming: string | null, expected: string) {
  const a = Buffer.from(incoming ?? ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function jsonRequest(url: string, init?: RequestInit, fetcher = fetch): Promise<any> {
  try {
    const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error("OAuth request failed; retry or run tally login --oauth to reconnect"); }
}
function endpoint(value: unknown, issuer: string): string {
  if (typeof value !== "string") throw new Error("OAuth server metadata is incomplete");
  const url = new URL(value);
  if (url.origin !== new URL(issuer).origin || url.username || url.password || url.hash || url.protocol !== "https:")
    throw new Error("OAuth server endpoint is unsafe");
  return url.toString();
}
function credentials(tokens: any, previous: Omit<OAuthCredentials, "accessToken" | "expiresAt">): OAuthCredentials {
  if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.access_token.length > 8192 ||
      String(tokens.token_type).toLowerCase() !== "bearer" || typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 ||
      (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== "string" || !tokens.refresh_token || tokens.refresh_token.length > 8192))) throw new Error("OAuth returned an invalid token response");
  return { ...previous, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? previous.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000, scope: typeof tokens.scope === "string" ? tokens.scope : previous.scope };
}
export async function oauthLogin(opts: { baseUrl: string; noOpen?: boolean; agentid?: boolean; scope?: string; timeoutMs?: number; configPath?: string; fetcher?: typeof fetch; onAuthorization?: (workflow: AuthorizationWorkflow) => void }) {
  const origin = oauthOrigin(opts.baseUrl), resource = `${origin}/api/mcp`, fetcher = opts.fetcher ?? fetch;
  const resourceMeta = await jsonRequest(`${origin}/.well-known/oauth-protected-resource/api/mcp`, undefined, fetcher);
  if (resourceMeta.resource !== resource || !Array.isArray(resourceMeta.authorization_servers) || resourceMeta.authorization_servers.length !== 1)
    throw new Error("OAuth resource metadata does not match this server");
  const issuer = oauthOrigin(resourceMeta.authorization_servers[0]);
  if (!issuer.startsWith("https://")) throw new Error("OAuth issuer requires HTTPS");
  const meta = await jsonRequest(`${issuer}/.well-known/oauth-authorization-server`, undefined, fetcher);
  if (meta.issuer !== resourceMeta.authorization_servers[0] || !meta.code_challenge_methods_supported?.includes("S256") || !meta.client_id_metadata_document_supported)
    throw new Error("OAuth server must support S256 PKCE and client metadata documents");
  const authorizationEndpoint = endpoint(meta.authorization_endpoint, issuer), tokenEndpoint = endpoint(meta.token_endpoint, issuer);
  const revocationEndpoint = meta.revocation_endpoint ? endpoint(meta.revocation_endpoint, issuer) : undefined;
  const clientId = `${origin}/.well-known/tally-cli.json`;
  let scope = opts.scope ?? "tally:read tally:write tally:manage";
  if (meta.scopes_supported?.includes("offline_access") && !scope.split(" ").includes("offline_access")) scope += " offline_access";
  const pkce = createPkce(), timeoutMs = Math.min(opts.timeoutMs ?? 600_000, 600_000);
  let resolve!: (value: URLSearchParams) => void, reject!: (error: Error) => void;
  const callback = new Promise<URLSearchParams>((yes, no) => { resolve = yes; reject = no; });
  void callback.catch(() => {});
  let accepted = false;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "text/plain; charset=utf-8");
    let url: URL;
    try { url = new URL(req.url ?? "/", REDIRECT); } catch { res.writeHead(400).end("Invalid callback URL"); return; }
    if (req.method !== "GET" || url.pathname !== "/callback" || accepted) { res.writeHead(404).end("Not found"); return; }
    if (req.headers.host !== "127.0.0.1:43819" || url.searchParams.getAll("state").length !== 1 || !validState(url.searchParams.get("state"), pkce.state)) { res.writeHead(400).end("Invalid callback state"); return; }
    if (url.searchParams.getAll("iss").length > 1) { res.writeHead(400).end("Invalid issuer"); return; }
    if ((meta.authorization_response_iss_parameter_supported && url.searchParams.get("iss") !== meta.issuer) || (url.searchParams.has("iss") && url.searchParams.get("iss") !== meta.issuer)) { res.writeHead(400).end("Invalid issuer"); return; }
    if (url.searchParams.has("error")) { accepted = true; res.end("Authorization declined. Return to your terminal."); reject(new Error("OAuth authorization declined")); return; }
    if (url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code") || url.searchParams.get("code")!.length > 8192) { res.writeHead(400).end("Missing code"); return; }
    accepted = true; res.end("Authorization received. Return to your terminal."); resolve(url.searchParams);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((yes, no) => { server.once("error", () => no(new Error("OAuth callback port is unavailable"))); server.listen(43819, "127.0.0.1", yes); });
    timer = setTimeout(() => reject(new Error("OAuth authorization timed out; run login again")), timeoutMs);
    const url = new URL(authorizationEndpoint);
    for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", resource, scope, state: pkce.state, code_challenge: pkce.challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
    let browserUrl = url;
    if (opts.agentid) {
      const continuation = `/login/oauth/continue?authorization_url=${encodeURIComponent(url.toString())}`;
      browserUrl = new URL("/login/agentid", origin);
      browserUrl.searchParams.set("next", continuation);
    }
    const workflow: AuthorizationWorkflow = { status: "authorization_required", authorizationUrl: browserUrl.toString(), redirectUri: REDIRECT, expiresIn: Math.ceil(timeoutMs / 1000), instructions: "Open authorizationUrl on this computer and approve access. Keep this command running until authorization finishes." };
    if (opts.onAuthorization) opts.onAuthorization(workflow); else console.error(JSON.stringify(workflow));
    if (!opts.noOpen) {
      if (process.platform !== "darwin") throw new Error("Use --no-open and open the authorization URL on this computer");
      await new Promise<void>((yes, no) => execFile("/usr/bin/open", ["-a", "Helium", browserUrl.toString()], error => error ? no(new Error("Could not open Helium; rerun with --no-open")) : yes()));
    }
    const params = await callback;
    const tokens = await jsonRequest(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: params.get("code")!, code_verifier: pkce.verifier, client_id: clientId, redirect_uri: REDIRECT, resource }) }, fetcher);
    const saved = credentials(tokens, { origin, resource, issuer, clientId, tokenEndpoint, revocationEndpoint, scope });
    writeFileConfig({ apiUrl: origin, token: undefined, oauth: saved }, opts.configPath);
    return { status: "authenticated", method: "oauth", origin, scope: saved.scope, expiresAt: saved.expiresAt };
  } finally { if (timer) clearTimeout(timer); server.close(); server.closeAllConnections(); }
}
const refreshing = new Map<string, Promise<string>>();
export async function oauthAccessToken(baseUrl: string, force = false, configPath = CONFIG_PATH, fetcher = fetch): Promise<string> {
  const origin = oauthOrigin(baseUrl), saved = readFileConfig(configPath).oauth;
  if (!saved || saved.origin !== origin || saved.resource !== `${origin}/api/mcp`) throw new Error("No OAuth credentials for this server; run tally login --oauth");
  if (!force && saved.expiresAt > Date.now() + 30_000) return saved.accessToken;
  const key = `${configPath}:${origin}`;
  if (refreshing.has(key)) return refreshing.get(key)!;
  const pending = (async () => {
    if (!saved.refreshToken) throw new Error("OAuth session expired; run tally login --oauth");
    const tokenEndpoint = endpoint(saved.tokenEndpoint, saved.issuer);
    const tokens = await jsonRequest(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refreshToken, client_id: saved.clientId, resource: saved.resource }) }, fetcher);
    const updated = credentials(tokens, saved);
    const current = readFileConfig(configPath).oauth;
    if (!current || current.origin !== saved.origin || current.refreshToken !== saved.refreshToken || current.accessToken !== saved.accessToken)
      throw new Error("OAuth credentials changed while refreshing; retry the command");
    writeFileConfig({ oauth: updated }, configPath);
    return updated.accessToken;
  })();
  refreshing.set(key, pending);
  try { return await pending; } finally { refreshing.delete(key); }
}
export function authStatus(baseUrl: string, configPath = CONFIG_PATH) {
  const origin = oauthOrigin(baseUrl), file = readFileConfig(configPath), oauth = file.oauth;
  return { origin, method: file.token ? "api_key" : oauth?.origin === origin ? "oauth" : "none", authenticated: !!file.token || !!(oauth?.origin === origin && (oauth.expiresAt > Date.now() || oauth.refreshToken)), ...(oauth?.origin === origin ? { expiresAt: oauth.expiresAt, scope: oauth.scope, refreshAvailable: !!oauth.refreshToken } : {}) };
}
export async function logout(baseUrl: string, configPath = CONFIG_PATH, fetcher = fetch) {
  const origin = oauthOrigin(baseUrl), saved = readFileConfig(configPath).oauth;
  let revoked = false, revocationFailed = false;
  try {
    if (saved?.origin === origin && saved.revocationEndpoint) {
      const url = endpoint(saved.revocationEndpoint, saved.issuer);
      for (const [token, hint] of [[saved.refreshToken, "refresh_token"], [saved.accessToken, "access_token"]]) {
        if (!token) continue;
        const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, token_type_hint: hint!, client_id: saved.clientId }) });
        if (!response.ok) throw new Error();
      }
      revoked = true;
    }
  } catch { revocationFailed = true; }
  finally { writeFileConfig({ token: undefined, ...(saved?.origin === origin ? { oauth: undefined } : {}) }, configPath); }
  return { status: "logged_out", revoked, revocationFailed };
}
