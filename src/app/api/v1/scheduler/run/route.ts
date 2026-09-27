import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import {
  runDueSchedules,
  type RecurringCapableProvider,
} from "@/server/scheduler";
import { previewDueSchedules } from "../../_lib/schedule-preview";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

/**
 * Run every due recurring schedule NOW. Generates draft invoices for
 * schedules whose nextRunAt has passed and advances them. Idempotent per
 * run: schedules advance past due slots, so re-calling only picks up newly
 * due schedules. Call this from cron (or the CLI) to automate billing.
 *
 * `?dry_run=true` previews the due schedules (would-create flags, line
 * item counts, estimated totals) without creating invoices or advancing.
 * Dry-run responses are never stored under an Idempotency-Key.
 */
export async function POST(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider() as unknown as RecurringCapableProvider;
  if (isDryRun(req)) {
    const due = await previewDueSchedules(provider);
    return ok({ dryRun: true, due });
  }
  return withIdempotency(req, async () => {
    const result = await runDueSchedules(provider);
    return ok(result);
  });
}
