import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
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

async function GETHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const schedule = await asRecurring(getServerProvider()).getRecurringSchedule(params.id);
  if (!schedule) return notFound("recurring schedule");
  return ok(schedule);
}

async function PATCHHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
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
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) return notFound(`client "${parsed.data.clientId}"`);
    }
    if (parsed.data.projectId) {
      const project = await provider.getProject(parsed.data.projectId);
      if (!project) return notFound(`project "${parsed.data.projectId}"`);
    }
    await provider.updateRecurringSchedule(params.id, parsed.data);
    const updated = await provider.getRecurringSchedule(params.id);
    return ok(updated);
  });
}

async function DELETEHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
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

export const GET = withApiRequestCache(GETHandler);
export const PATCH = withApiRequestCache(PATCHHandler);
export const DELETE = withApiRequestCache(DELETEHandler);
