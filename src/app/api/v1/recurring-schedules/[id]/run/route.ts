import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { notFound, ok } from "@/server/http";
import { withIdempotency } from "../../../_lib/idempotency";
import {
  runScheduleNow,
  type RecurringCapableProvider,
} from "@/server/scheduler";
import { previewScheduleRun } from "../../../_lib/schedule-preview";
import { isDryRun } from "../../../_lib/query";

export const runtime = "nodejs";

/**
 * Force-run a single schedule NOW, even if it isn't due (or is paused).
 * Generates a draft invoice from the schedule's current definition and
 * advances it one occurrence. Returns the run result.
 *
 * `?dry_run=true` previews what would happen without creating the
 * invoice or advancing the schedule. Dry-run responses are never stored
 * under an Idempotency-Key.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider() as unknown as RecurringCapableProvider;
  if (isDryRun(req)) {
    const schedule = await provider.getRecurringSchedule(params.id);
    if (!schedule) return notFound("recurring schedule");
    return ok({ dryRun: true, preview: await previewScheduleRun(provider, schedule) });
  }
  return withIdempotency(req, async () => {
    const result = await runScheduleNow(provider, params.id);
    if (!result) return notFound("recurring schedule");
    return ok(result);
  });
}
