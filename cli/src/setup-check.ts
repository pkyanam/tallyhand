/** Public deployment checks, owned by the CLI and never using account credentials. */
export async function checkSetup(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const paths = ["/docs", "/setup.sh", "/installer/setup.sh", "/llms.txt", "/.well-known/tally-cli.json", "/.well-known/oauth-protected-resource/api/mcp"];
  const texts = new Map<string, string>();
  for (const path of paths) {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    texts.set(path, await res.text());
  }
  if (!texts.get("/setup.sh")?.startsWith("#!/usr/bin/env bash") || texts.get("/setup.sh") !== texts.get("/installer/setup.sh")) throw new Error("Installer content mismatch");
  if (!texts.get("/docs")?.includes("Install or update the CLI") || !texts.get("/llms.txt")?.startsWith("# Tallyhand")) throw new Error("Documentation missing");
  const metadata = JSON.parse(texts.get("/.well-known/oauth-protected-resource/api/mcp")!);
  const client = JSON.parse(texts.get("/.well-known/tally-cli.json")!);
  if (metadata.resource !== `${origin}/api/mcp` || !metadata.authorization_servers?.length || client.client_id !== `${origin}/.well-known/tally-cli.json`) throw new Error("OAuth metadata incomplete");
  const issuer = metadata.authorization_servers[0];
  const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!res.ok) throw new Error(`Clerk discovery: HTTP ${res.status}`);
  const discovery = await res.json() as { client_id_metadata_document_supported?: boolean; code_challenge_methods_supported?: string[]; scopes_supported?: string[] };
  if (!discovery.client_id_metadata_document_supported || !discovery.code_challenge_methods_supported?.includes("S256")) throw new Error("Clerk CIMD/PKCE discovery incomplete");
  for (const scope of ["tally:read", "tally:write", "tally:manage"]) if (!discovery.scopes_supported?.includes(scope)) throw new Error(`Clerk discovery missing ${scope}`);
  console.log(JSON.stringify({ ok: true, publicPaths: paths, oauthDiscovery: true, note: "Discovery checks do not verify consent or token exchange" }, null, 2));
}
