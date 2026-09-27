/**
 * Revoke (delete) one of the signed-in user's personal API tokens.
 *
 *   DELETE /api/v1/api-tokens/[id]
 *
 * Session-authed like the collection route (see ../route.ts) — bearer
 * tokens are not accepted.
 */
import { effectiveAuth } from "@/lib/mode";
import { requireSessionUserId } from "@/lib/auth/session";
import { revokeApiToken } from "@/lib/auth/api-tokens";
import { json, notFound } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (effectiveAuth() === "none") {
    return notFound("API tokens are unavailable in single-user local mode");
  }
  let userId: string;
  try {
    userId = await requireSessionUserId();
  } catch {
    return json({ error: { code: "unauthorized", message: "Not signed in" } }, 401);
  }
  const revoked = await revokeApiToken(userId, params.id);
  if (!revoked) return notFound("API token");
  return json({ data: { revoked: true } });
}
