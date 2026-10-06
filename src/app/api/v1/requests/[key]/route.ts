import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { ok, badRequest } from "@/server/http";
import { convexReceiptKey } from "@/server/convex-idempotency";
import { recoveryContext, recoveryError } from "@/server/workflow-recovery";
export const runtime = "nodejs";

async function GETHandler(req: Request, { params }: { params: { key: string } }) {
  const denied = await requireApiToken(req); if (denied) return denied;
  if (!params.key || params.key.length > 256) return badRequest("Request key must contain 1 to 256 characters");
  try {
    const context = await recoveryContext(); if (context instanceof Response) return context;
    const receipt = await context.client.query("idempotency:status", { key: convexReceiptKey(context.owner, params.key) }) as { state: "pending" | "complete"; status: number | null; createdAt: number } | null;
    if (!receipt) return recoveryError("REQUEST_NOT_FOUND", "No durable receipt found in this workspace; verify the operation outcome before submitting a new key", 404);
    return ok({ ...receipt, requiresReconciliation: receipt.state === "pending" });
  } catch { return recoveryError("RECOVERY_UNAVAILABLE", "Request receipt temporarily unavailable; verify the operation outcome before retrying", 503); }
}
export const GET = withApiRequestCache(GETHandler);
