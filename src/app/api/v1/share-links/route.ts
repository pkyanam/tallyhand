import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { getShareDeps } from "@/lib/share/server-deps";
import { createShareLink, CreateShareSchema } from "@/lib/share/service";
import { ok, created, badRequest } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
export const runtime = "nodejs";
async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  try { return ok(await getShareDeps().ownerProvider.listShareLinks()); }
  catch { return Response.json({ error: { code: "sharing_unavailable", message: "Share links require a configured hosted backend" } }, { status: 503 }); }
}
async function POSTHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const body = await req.clone().json().catch(() => null);
  if (body?.confirmPublicSharing !== true) return badRequest("Explicit approval to create a public share link is required");
  const parsed = CreateShareSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid share request", parsed.error.issues);
  // Cloud tools publish server-owned invoice data, never arbitrary invoice snapshots.
  if (parsed.data.type === "invoice" && parsed.data.target.snapshot) return badRequest("Cloud invoice shares must reference an existing invoice");
  return withIdempotency(req, async () => {
    try { const share = await createShareLink(getShareDeps(), parsed.data); return created({ id: share.link.id, url: share.url, expiresAt: share.link.expiresAt, type: share.link.type }); }
    catch (err) { const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 400; return Response.json({ error: { code: status === 404 ? "not_found" : "sharing_unavailable", message: status === 404 ? "Share target not found" : "Could not create this share link" } }, { status: [400,403,404,409].includes(status) ? status : 503 }); }
  });
}

export const GET = withApiRequestCache(GETHandler);
export const POST = withApiRequestCache(POSTHandler);
