import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { ok, badRequest } from "@/server/http";
import { recoveryContext, recoveryError } from "@/server/workflow-recovery";
export const runtime = "nodejs";

async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const since = new URL(req.url).searchParams.get("since");
  if (since !== null && (!/^\d+$/.test(since) || !Number.isSafeInteger(Number(since)))) return badRequest("since must be a nonnegative integer revision");
  try {
    const context = await recoveryContext(); if (context instanceof Response) return context;
    const revision = await context.client.query("workspace:revision", { userId: context.owner }) as number;
    // A revision is an invalidation marker, not a replayable event history.
    return ok({ available: true, revision, changed: since === null ? null : revision !== Number(since), pollAfterMs: 2000 });
  } catch { return recoveryError("RECOVERY_UNAVAILABLE", "Workspace revision temporarily unavailable", 503); }
}
export const GET = withApiRequestCache(GETHandler);
