import { createHash } from "node:crypto";
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
  const catalogResponse = await fetch(origin + "/plugins/catalog.json", { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!catalogResponse.ok) throw new Error("Plugin catalog unavailable");
  const catalog = await catalogResponse.json() as { packages?: Array<{ name: string; archive: string; sha256: string }> };
  const current = catalog.packages?.find(pkg => pkg.name === "tallyhand");
  if (!current || !/^[a-f0-9]{64}$/.test(current.sha256)) throw new Error("Invalid plugin catalog");
  const pluginUrl = new URL(current.archive, origin);
  if (pluginUrl.origin !== origin || !/^\/plugins\/tallyhand-[a-zA-Z0-9.-]+\.zip$/.test(pluginUrl.pathname) || pluginUrl.search || pluginUrl.hash) throw new Error("Invalid plugin archive URL");
  const pluginPath = pluginUrl.pathname;
  const [archive, checksum] = await Promise.all([fetch(origin + pluginPath, { signal: AbortSignal.timeout(30_000), redirect: "error" }), fetch(origin + pluginPath + ".sha256", { signal: AbortSignal.timeout(30_000), redirect: "error" })]);
  if (!archive.ok || !checksum.ok) throw new Error("Plugin download unavailable");
  const bytes = Buffer.from(await archive.arrayBuffer());
  const expected = (await checksum.text()).trim().split(/\s+/)[0];
  if (bytes.length < 4 || bytes.length > 8 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0x04034b50 || expected !== current.sha256 || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Plugin package integrity check failed");
  console.log(JSON.stringify({ ok: true, plugin: { path: pluginPath, bytes: bytes.length, checksum: "verified" }, publicPaths: paths, oauthDiscovery: true, note: "Discovery checks do not verify consent or token exchange" }, null, 2));
}
