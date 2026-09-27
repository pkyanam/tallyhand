import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { clientPatchSchema } from "@/server/validation";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";
import type { RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const client = await getServerProvider().getClient(params.id);
  if (!client) return notFound("client");
  return ok(client);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider();
    const existing = await provider.getClient(params.id);
    if (!existing) return notFound("client");
    const body: unknown = await req.json().catch(() => null);
    const parsed = clientPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid client patch", parsed.error.issues);
    }
    await provider.updateClient(params.id, parsed.data);
    const updated = await provider.getClient(params.id);
    return ok(updated);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getClient(params.id);
  if (!existing) return notFound("client");
  const projectCount = (await provider.listProjectsByClient(params.id)).length;
  const invoiceCount = (await provider.listInvoices()).filter(
    (i) => i.clientId === params.id,
  ).length;
  const expenseCount = (await provider.listExpenses()).filter(
    (e) => e.clientId === params.id,
  ).length;
  const recurring = provider as unknown as RecurringCapableProvider;
  const scheduleCount = (await recurring.listRecurringSchedulesByClient(params.id)).length;
  const retainerCount = (await recurring.listRetainersByClient(params.id)).length;
  const childCount = projectCount + invoiceCount + expenseCount + scheduleCount + retainerCount;
  if (childCount > 0) {
    return conflict(
      `Client has ${projectCount} project(s), ${invoiceCount} invoice(s), ${expenseCount} expense(s), ${scheduleCount} recurring schedule(s) and ${retainerCount} retainer(s) — delete those first, or archive the client instead (PATCH { archived: true })`,
      {
        id: existing.id,
        projectCount,
        invoiceCount,
        expenseCount,
        scheduleCount,
        retainerCount,
      },
    );
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: { entity: "client", id: existing.id, name: existing.name },
    });
  }
  await provider.removeClient(params.id);
  return noContent();
}