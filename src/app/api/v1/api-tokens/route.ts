/**
 * Personal API-token management for the signed-in user.
 *
 *   GET  /api/v1/api-tokens      list the caller's tokens (no hashes)
 *   POST /api/v1/api-tokens      create a token { name? } → raw token once
 *
 * Unlike the rest of /api/v1, these routes are SESSION-authed, not
 * token-authed: they require an interactive session (Clerk session or
 * builtin session cookie) via requireSessionUserId(). Bearer tokens —
 * shared or personal — are rejected, so a leaked token can't mint fresh
 * tokens. TALLY_AUTH=none → 404 (no signed-in users exist).
 */
import { effectiveAuth } from "@/lib/mode";
import { requireSessionUserId } from "@/lib/auth/session";
import { createApiToken, listApiTokens } from "@/lib/auth/api-tokens";
import { badRequest, created, json, notFound } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabled(): Response | null {
  if (effectiveAuth() === "none") {
    return notFound("API tokens are unavailable in single-user local mode");
  }
  return null;
}

async function session(): Promise<{ userId: string } | Response> {
  const off = disabled();
  if (off) return off;
  try {
    return { userId: await requireSessionUserId() };
  } catch {
    return json({ error: { code: "unauthorized", message: "Not signed in" } }, 401);
  }
}

export async function GET() {
  const s = await session();
  if (s instanceof Response) return s;
  const tokens = await listApiTokens(s.userId);
  return json({ data: tokens });
}

export async function POST(req: Request) {
  const s = await session();
  if (s instanceof Response) return s;
  const body: unknown = await req.json().catch(() => null);
  const name =
    body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name
      : "";
  if (name.length > 64) return badRequest("Token name is too long (max 64 chars)");
  const secret = await createApiToken(s.userId, name);
  // The raw token is returned exactly once, here. It is never stored.
  return created({
    id: secret.id,
    name: secret.name,
    prefix: secret.prefix,
    createdAt: secret.createdAt,
    token: secret.token,
  });
}
