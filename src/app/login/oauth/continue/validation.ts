/** Only the configured issuer's canonical CLI authorization request may continue. */
export function safeLocalNext(value?: string): string {
  if (typeof value !== "string" || !value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\r\n]/.test(decoded)) return "/";
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/";
    return url.pathname + url.search;
  } catch { return "/"; }
}
export function validateOAuthContinuation(value: string, origin: string, issuer: string, authorizationEndpoint: string): string {
  const endpoint = new URL(authorizationEndpoint), trusted = new URL(issuer), url = new URL(value);
  if (trusted.protocol !== "https:" || endpoint.protocol !== "https:" || endpoint.origin !== trusted.origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      url.origin !== endpoint.origin || url.pathname !== endpoint.pathname || url.username || url.password || url.hash)
    throw new Error("Invalid OAuth continuation");
  const required: Record<string, string> = { client_id: `${origin}/.well-known/tally-cli.json`, redirect_uri: "http://127.0.0.1:43819/callback", response_type: "code", resource: `${origin}/api/mcp`, code_challenge_method: "S256" };
  const allowed = new Set([...Object.keys(required), "scope", "state", "code_challenge"]);
  for (const [key] of url.searchParams) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error("Invalid OAuth continuation");
  for (const [key, expected] of Object.entries(required)) if (url.searchParams.get(key) !== expected) throw new Error("Invalid OAuth continuation");
  if (!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "") || !/^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get("state") ?? "")) throw new Error("Invalid OAuth continuation");
  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  if (!scopes.includes("tally:read") || new Set(scopes).size !== scopes.length || scopes.some(scope => !["tally:read", "tally:write", "tally:manage", "offline_access"].includes(scope))) throw new Error("Invalid OAuth continuation");
  return url.toString();
}
