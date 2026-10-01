import { withApiRequestCache } from "@/lib/auth/request-cache";
import { resolveUserId } from "@/lib/auth/session";
import { requireApiToken } from "@/server/auth";
import { getShareDeps } from "@/lib/share/server-deps";
import { ok, notFound } from "@/server/http";
export const runtime = "nodejs";
async function DELETEHandler(req: Request, { params }: { params: { id: string } }) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const owner = getShareDeps().ownerProvider;
  const link = await owner.getShareLinkById(params.id);
  if (!link || link.userId !== await resolveUserId()) return notFound("Share link");
  await owner.revokeShareLink(params.id);
  return ok({ revoked: true, id: params.id });
}

export const DELETE = withApiRequestCache(DELETEHandler);
