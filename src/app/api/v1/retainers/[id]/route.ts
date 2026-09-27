import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { retainerPatchSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

function asRetainers(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const retainer = await asRetainers(getServerProvider()).getRetainer(params.id);
  if (!retainer) return notFound("retainer");
  return ok(retainer);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = asRetainers(getServerProvider());
    const existing = await provider.getRetainer(params.id);
    if (!existing) return notFound("retainer");
    const body: unknown = await req.json().catch(() => null);
    const parsed = retainerPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid retainer patch", parsed.error.issues);
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) return notFound(`client "${parsed.data.clientId}"`);
    }
    if (parsed.data.recurringScheduleId) {
      const schedule = await provider.getRecurringSchedule(parsed.data.recurringScheduleId);
      if (!schedule) {
        return notFound(`recurring schedule "${parsed.data.recurringScheduleId}"`);
      }
    }
    await provider.updateRetainer(params.id, parsed.data);
    const updated = await provider.getRetainer(params.id);
    return ok(updated);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const provider = asRetainers(getServerProvider());
  const existing = await provider.getRetainer(params.id);
  if (!existing) return notFound("retainer");
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: {
        entity: "retainer",
        id: existing.id,
        name: existing.name,
        status: existing.status,
      },
    });
  }
  await provider.removeRetainer(params.id);
  return noContent();
}
