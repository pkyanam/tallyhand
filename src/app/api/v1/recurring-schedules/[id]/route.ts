import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { recurringSchedulePatchSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

function asRecurring(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const schedule = await asRecurring(getServerProvider()).getRecurringSchedule(params.id);
  if (!schedule) return notFound("recurring schedule");
  return ok(schedule);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
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
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = asRecurring(getServerProvider());
  const existing = await provider.getRecurringSchedule(params.id);
  if (!existing) return notFound("recurring schedule");
  await provider.removeRecurringSchedule(params.id);
  return noContent();
}
