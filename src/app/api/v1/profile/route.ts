import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { resolveUserId } from "@/lib/auth/session";
import { getServerProvider } from "@/server/provider";
import { ok } from "@/server/http";
export const runtime = "nodejs";
async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const id = await resolveUserId();
  if (!id) return Response.json({ error: { code: "profile_unavailable", message: "Authenticated profile unavailable" } }, { status: 401 });
  const settings = await getServerProvider().getSettings();
  return ok({ id, name: settings.business.ownerName || settings.business.name || "Tallyhand workspace" });
}

export const GET = withApiRequestCache(GETHandler);
