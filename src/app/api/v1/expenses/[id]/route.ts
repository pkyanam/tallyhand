import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { expensePatchSchema } from "@/server/validation";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const expense = await getServerProvider().getExpense(params.id);
  if (!expense) return notFound("expense");
  return ok(expense);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider();
    const existing = await provider.getExpense(params.id);
    if (!existing) return notFound("expense");
    const body: unknown = await req.json().catch(() => null);
    const parsed = expensePatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid expense patch", parsed.error.issues);
    }
    if (parsed.data.projectId) {
      const project = await provider.getProject(parsed.data.projectId);
      if (!project) {
        return notFound(`project "${parsed.data.projectId}"`);
      }
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) return notFound(`client "${parsed.data.clientId}"`);
    }
    await provider.updateExpense(params.id, parsed.data);
    const updated = await provider.getExpense(params.id);
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
  const existing = await provider.getExpense(params.id);
  if (!existing) return notFound("expense");
  if (existing.isBilled) {
    return conflict(
      "This expense is billed on an invoice — deleting it would corrupt invoice lineage. Delete the invoice first if it is still a draft.",
      { id: existing.id, invoiceId: existing.invoiceId },
    );
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: {
        entity: "expense",
        id: existing.id,
        amount: existing.amount,
        category: existing.category,
      },
    });
  }
  await provider.removeExpense(params.id);
  return noContent();
}