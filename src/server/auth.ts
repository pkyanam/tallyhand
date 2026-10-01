/**
 * SERVER ONLY — never import from client components.
 *
 * Token auth for API v1 and /api/mcp. Two credential kinds are accepted:
 *
 * 1. The shared server secret `TALLYHAND_API_TOKEN` (self-hosted story: one
 *    secret, no user accounts). Requests are attributed per the auth mode
 *    (see `resolveUserId()`).
 * 2. Personal API tokens (`thp_…`, created by a signed-in user in
 *    Settings → Connect). Only the SHA-256 hash is stored server-side
 *    (`src/lib/auth/api-tokens.ts`); a verified token attributes the request
 *    to its owner's user id.
 *
 * Both travel as `Authorization: Bearer <token>`.
 */
import { timingSafeEqual } from "node:crypto";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: JSON_HEADERS,
  });
}

function bearerValue(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : "";
}

function sharedTokenMatches(provided: string): boolean {
  const token = process.env.TALLYHAND_API_TOKEN ?? "";
  if (!provided || !token) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Returns a 503/401 Response when the request is not authorized, or `null`
 * when it is. Call at the top of every protected route handler:
 *
 *   const authErr = await requireApiToken(req);
 *   if (authErr) return authErr;
 *
 * On success the request's user attribution is left to `resolveUserId()`,
 * which resolves personal `thp_…` tokens to their owner's user id.
 */
export async function requireApiToken(req: Request): Promise<Response | null> {
  const provided = bearerValue(req);
  if (sharedTokenMatches(provided)) return null;

  if (provided) {
    const { isOAuthToken, verifyTallyOAuth, requiredRestScope, oauthChallenge } = await import("@/lib/auth/oauth");
    if (isOAuthToken(provided)) {
      const identity = await verifyTallyOAuth(provided);
      if (!identity) return oauthChallenge();
      const required = requiredRestScope(req);
      if (!required) return jsonError(403, "forbidden", "OAuth access is limited to workspace API operations");
      return identity.scopes.includes(required) ? null : oauthChallenge(403, [...new Set(["tally:read", required])]);
    }
  }

  // Personal token (Settings → Connect). Lazy import keeps the token store
  // (pg/convex/node:sqlite) out of the module graph until it's needed.
  if (provided) {
    const { findApiToken } = await import("@/lib/auth/api-tokens");
    if (await findApiToken(provided)) return null;
  }

  if (!provided && !process.env.TALLYHAND_API_TOKEN) {
    return jsonError(
      503,
      "api_disabled",
      "Set TALLYHAND_API_TOKEN to enable the API",
    );
  }
  return jsonError(401, "unauthorized", "Invalid or missing API token");
}
