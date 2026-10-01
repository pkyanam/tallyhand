/** One API client and tool catalog serve modern and legacy MCP clients. */
import { withRequestAuthCache } from "@/lib/auth/request-cache";
import { dispatchWorkspaceApi } from "@/server/internal-api";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { requireApiToken } from "@/server/auth";
import { isOAuthToken, oauthChallenge, oauthConfig, verifyTallyOAuth, oauthUnavailableResponse, TALLY_SCOPES } from "@/lib/auth/oauth";
import { createMcpServer } from "../../../../cli/src/mcp.js";
import { TallyhandClient } from "../../../../cli/src/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Native MCP clients do not send browser Origin.
  const allowed = [oauthConfig().origin, ...(process.env.TALLY_MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)];
  if (process.env.NODE_ENV !== "production") allowed.push(new URL(req.url).origin);
  return allowed.includes(origin);
}
function cors(req: Request, res: Response): Response {
  const origin = req.headers.get("origin");
  if (origin && allowedOrigin(req)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.append("Vary", "Origin");
  }
  res.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
const handler = createMcpHandler(ctx => {
  // Never derive the credential forwarding destination from Host/Origin input.
  const base = oauthConfig().origin;
  const api = new TallyhandClient({ baseUrl: base, token: ctx.authInfo?.token, signal: ctx.requestInfo?.signal, fetcher: dispatchWorkspaceApi });
  return createMcpServer(api, { oauth: ctx.authInfo?.extra?.kind === "oauth", legacyOAuth: ctx.era === "legacy" });
}, { legacy: "stateless", responseMode: "auto", maxRequestBodySize: 4 * 1024 * 1024 + 32768, maxSubscriptions: 32 });

function handle(req: Request): Promise<Response> { return withRequestAuthCache(() => handleRequest(req)); }
async function handleRequest(req: Request): Promise<Response> {
  const started = performance.now();
  if (!allowedOrigin(req)) return new Response("Origin not allowed", { status: 403 });
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token) { console.info("mcp_auth", { outcome: "missing_bearer", method: req.method }); return cors(req, oauthChallenge()); }
  let authInfo: AuthInfo;
  if (isOAuthToken(token)) {
    let identity;
    try { identity = await verifyTallyOAuth(token); } catch { console.warn("mcp_auth", { outcome: "verification_unavailable", method: req.method }); return cors(req, oauthUnavailableResponse()); }
    if (!identity) { console.info("mcp_auth", { outcome: "invalid_oauth_token", method: req.method }); return cors(req, oauthChallenge()); }
    if (!identity.scopes.includes("tally:read")) { console.info("mcp_auth", { outcome: "missing_read_scope", method: req.method }); return cors(req, oauthChallenge(403)); }
    authInfo = { token, clientId: identity.clientId, scopes: identity.scopes, expiresAt: identity.expiresAt,
      resource: new URL(oauthConfig().resource), resourceMetadataUrl: oauthConfig().metadataUrl, extra: { kind: "oauth", userId: identity.userId } };
  } else {
    const denied = await requireApiToken(req);
    if (denied) return cors(req, oauthChallenge());
    authInfo = { token, clientId: "tallyhand-api-key", scopes: [...TALLY_SCOPES], extra: { kind: "api-key" } };
  }
  const authenticated = performance.now();
  const response = await handler.fetch(req, { authInfo });
  response.headers.set("Server-Timing", `auth;dur=${(authenticated - started).toFixed(1)}, mcp;dur=${(performance.now() - authenticated).toFixed(1)}`);
  return cors(req, response);
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export async function OPTIONS(req: Request): Promise<Response> {
  if (!allowedOrigin(req)) return new Response("Origin not allowed", { status: 403 });
  const res = new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Max-Age": "600",
  } });
  return cors(req, res);
}
