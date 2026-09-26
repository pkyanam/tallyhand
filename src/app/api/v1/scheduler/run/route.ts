import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { ok } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { runDueSchedules, type RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

/**
 * Run every due recurring schedule NOW. Generates draft invoices for
 * schedules whose nextRunAt has passed and advances them. Idempotent per
 * run: schedules advance past due slots, so re-calling only picks up newly
 * due schedules. Call this from cron (or the CLI) to automate billing.
 */
export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider() as unknown as RecurringCapableProvider;
    const result = await runDueSchedules(provider);
    return ok(result);
  });
}
