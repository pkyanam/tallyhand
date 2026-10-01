/** One-shot OAuth verification. Grants are kept in memory, never in saved CLI config. */
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { auth, type OAuthClientProvider, type StoredOAuthTokens, type OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { checkMcp } from "./mcp-check.js";

export async function checkOAuth(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  if (!origin.startsWith("https://")) throw new Error("OAuth verification requires an HTTPS server");
  const redirectUrl = "http://127.0.0.1:43819/callback";
  const state = randomBytes(32).toString("hex");
  let verifier = "";
  let tokens: StoredOAuthTokens | undefined;
  let discovery: OAuthDiscoveryState | undefined;
  let finish!: (params: URLSearchParams) => void;
  let fail!: (error: Error) => void;
  const callback = new Promise<URLSearchParams>((resolve, reject) => { finish = resolve; fail = reject; });
  // Attach rejection immediately so timeouts cannot become unhandled while discovering.
  void callback.catch(() => {});
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const url = new URL(req.url ?? "/", redirectUrl);
    if (req.method !== "GET" || url.pathname !== "/callback") { res.writeHead(404).end("Not found"); return; }
    const incoming = Buffer.from(url.searchParams.get("state") ?? "");
    const expected = Buffer.from(state);
    if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) { res.writeHead(400).end("Invalid state"); return; }
    if (url.searchParams.has("error")) { res.end("Authorization declined. You can close this tab."); fail(new Error("OAuth consent was declined")); return; }
    if (!url.searchParams.get("code")) { res.writeHead(400).end("Missing authorization code"); return; }
    res.end("Authorization received. Return to the terminal for verification results.");
    finish(url.searchParams);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(43819, "127.0.0.1", resolve); });
    timer = setTimeout(() => fail(new Error("OAuth consent timed out after 10 minutes; run the command again")), 600_000);
    const provider: OAuthClientProvider = {
      redirectUrl, clientMetadataUrl: `${origin}/.well-known/tally-cli.json`,
      clientMetadata: { client_name: "Tallyhand CLI verification", redirect_uris: [redirectUrl], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "tally:read" },
      state: () => state, clientInformation: () => undefined,
      tokens: () => tokens, saveTokens: value => { tokens = value; },
      saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
      saveDiscoveryState: value => { discovery = value; }, discoveryState: () => discovery,
      redirectToAuthorization: url => { console.error("Open this URL in a browser on the same computer as the CLI, then approve read-only access:\n" + url.toString()); },
    };
    const options = { serverUrl: `${origin}/api/mcp`, scope: "tally:read", resourceMetadataUrl: new URL(`${origin}/.well-known/oauth-protected-resource/api/mcp`) };
    if (await auth(provider, options) !== "REDIRECT") throw new Error("Expected a fresh OAuth authorization flow");
    const params = await callback;
    await auth(provider, { ...options, authorizationCode: params.get("code")!, iss: params.get("iss") ?? undefined });
    const token = (tokens as StoredOAuthTokens | undefined)?.access_token;
    if (!token) throw new Error("OAuth did not return an access token");
    await checkMcp({ baseUrl: origin, token }, { transport: "http", protocol: "modern", workspace: true });
    console.error("OAuth read-only check passed. Tokens were not saved; manage this grant in your Clerk account.");
  } finally { if (timer) clearTimeout(timer); server.close(); server.closeAllConnections(); tokens = undefined; verifier = ""; }
}
