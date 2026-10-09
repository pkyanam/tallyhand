import { createHash, timingSafeEqual } from "node:crypto";
import { runFinancialRecoveryBatch } from "@/server/financial-worker";
export const runtime = "nodejs";
export const maxDuration = 300;
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(secret));
}
/** Scheduler entry point; absent CRON_SECRET disables the job. */
export async function GET(request: Request) {
  if (!authorized(request))
    return Response.json(
      {
        error: {
          code: "unauthorized",
          message: "Scheduled recovery authorization required",
        },
      },
      { status: 401 },
    );
  try {
    return Response.json({ data: await runFinancialRecoveryBatch() });
  } catch {
    return Response.json(
      {
        error: {
          code: "financial_recovery_unavailable",
          message: "Scheduled financial recovery unavailable",
        },
      },
      { status: 503 },
    );
  }
}
export const POST = GET;
