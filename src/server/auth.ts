/**
 * SERVER ONLY — never import from client components.
 *
 * Token auth for API v1. A single shared bearer token (TALLYHAND_API_TOKEN)
 * keeps the self-hosted story simple: one secret, no user accounts yet.
 * Multi-user auth arrives with the hosted deployment (Phase 4).
 */
import { timingSafeEqual } from "node:crypto";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Returns a 503/401 Response when the request is not authorized, or `null`
 * when it is. Call at the top of every protected route handler:
 *
 *   const authErr = requireApiToken(req);
 *   if (authErr) return authErr;
 */
export function requireApiToken(req: Request): Response | null {
  const token = process.env.TALLYHAND_API_TOKEN;
  if (!token) {
    return jsonError(
      503,
      "api_disabled",
      "Set TALLYHAND_API_TOKEN to enable the API",
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header.trim());
  const provided = match ? match[1] : "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(token, "utf8");
  const valid = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  if (!valid) {
    return jsonError(401, "unauthorized", "Invalid or missing API token");
  }
  return null;
}
