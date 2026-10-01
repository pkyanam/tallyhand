/** Clerk OAuth tokens are resource-bound; session JWTs are never substitutes. */
import { createClerkClient } from "@clerk/backend";

export const TALLY_SCOPES = ["tally:read", "tally:write", "tally:manage"] as const;
export interface TallyOAuthIdentity { userId: string; clientId: string; scopes: string[]; expiresAt?: number }
export function oauthConfig() {
  const base = process.env.APP_BASE_URL ?? process.env.TALLYHAND_APP_URL ?? "http://localhost:3000";
  const origin = new URL(base).origin;
  const issuer = process.env.TALLY_OAUTH_ISSUER;
  return { enabled: process.env.TALLY_MCP_OAUTH_ENABLED === "true" && !!issuer,
    issuer, origin, resource: `${origin}/api/mcp`, metadataUrl: `${origin}/.well-known/oauth-protected-resource/api/mcp` };
}
export function isOAuthToken(token: string): boolean {
  return token.length <= 8192 && (token.startsWith("oat_") || /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
}
export async function verifyTallyOAuth(token: string): Promise<TallyOAuthIdentity | null> {
  const config = oauthConfig();
  if (!config.enabled || !isOAuthToken(token) || !process.env.CLERK_SECRET_KEY) return null;
  try {
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    // Verification is against this Clerk instance and the exact MCP resource.
    // Missing/wrong aud, revoked/expired tokens and non-user subjects fail closed.
    const verified = await clerk.idPOAuthAccessToken.verify(token, { audience: config.resource });
    if (verified.revoked || verified.expired || !verified.subject.startsWith("user_") ||
        !verified.aud?.includes(config.resource) || !verified.clientId ||
        (verified.expiration != null && verified.expiration <= Date.now() / 1000)) return null;
    return { userId: verified.subject, clientId: verified.clientId, scopes: verified.scopes, ...(verified.expiration != null ? { expiresAt: verified.expiration } : {}) };
  } catch { return null; } // Never echo an upstream error containing credentials.
}
export function oauthChallenge(status = 401, scopes: string[] = ["tally:read"]): Response {
  const config = oauthConfig();
  const challenge = `Bearer resource_metadata="${config.metadataUrl}", scope="${scopes.join(" ")}"${status === 403 ? ', error="insufficient_scope"' : ''}`;
  return Response.json({ error: { code: status === 403 ? "insufficient_scope" : "unauthorized", message: status === 403 ? "Additional authorization is required" : "A valid API key or resource-bound OAuth access token is required" } }, {
    status, headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" },
  });
}
export function requiredRestScope(req: Request): string | null {
  const path = new URL(req.url).pathname;
  if (!/^\/api\/v1\/(clients|projects|tasks|expenses|invoices|settings|recurring-schedules|retainers|data|mileage|contracts|tax-payments|rate-cards)(\/|$)/.test(path)) return null;
  if (req.method === "GET" || req.method === "HEAD") return "tally:read";
  if (req.method === "DELETE" || path === "/api/v1/data" || /\/(send|paid)$/.test(path)) return "tally:manage";
  return "tally:write";
}
