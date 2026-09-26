import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { notFound, ok } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { runScheduleNow, type RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

/**
 * Force-run a single schedule NOW, even if it isn't due (or is paused).
 * Generates a draft invoice from the schedule's current definition and
 * advances it one occurrence. Returns the run result.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider() as unknown as RecurringCapableProvider;
    const result = await runScheduleNow(provider, params.id);
    if (!result) return notFound("recurring schedule");
    return ok(result);
  });
}
