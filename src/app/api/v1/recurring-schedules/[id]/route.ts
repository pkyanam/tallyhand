import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { recurringSchedulePatchSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

function asRecurring(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const schedule = await asRecurring(getServerProvider()).getRecurringSchedule(params.id);
  if (!schedule) return notFound("recurring schedule");
  return ok(schedule);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = asRecurring(getServerProvider());
    const existing = await provider.getRecurringSchedule(params.id);
    if (!existing) return notFound("recurring schedule");
    const body: unknown = await req.json().catch(() => null);
    const parsed = recurringSchedulePatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid recurring schedule patch", parsed.error.issues);
    }
    await provider.updateRecurringSchedule(params.id, parsed.data);
    const updated = await provider.getRecurringSchedule(params.id);
    return ok(updated);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const provider = asRecurring(getServerProvider());
  const existing = await provider.getRecurringSchedule(params.id);
  if (!existing) return notFound("recurring schedule");
  const referencingRetainers = (await provider.listRetainers()).filter(
    (r) => r.recurringScheduleId === params.id,
  );
  if (referencingRetainers.length > 0) {
    return conflict(
      `Schedule is referenced by ${referencingRetainers.length} retainer(s) — detach or delete them first`,
      {
        id: existing.id,
        retainerIds: referencingRetainers.map((r) => r.id),
      },
    );
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: {
        entity: "recurring-schedule",
        id: existing.id,
        name: existing.name,
        status: existing.status,
      },
    });
  }
  await provider.removeRecurringSchedule(params.id);
  return noContent();
}
