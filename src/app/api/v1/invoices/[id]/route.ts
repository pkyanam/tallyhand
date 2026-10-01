import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { invoicePatchSchema } from "@/server/validation";
import { invoiceTotals } from "@/core/invoice";
import { newId } from "@/core/id";
import type { InvoiceLineItem } from "@/core/entities";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

async function GETHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const invoice = await getServerProvider().getInvoice(params.id);
  if (!invoice) return notFound("invoice");
  return ok(invoice);
}

async function PATCHHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider();
    const existing = await provider.getInvoice(params.id);
    if (!existing) return notFound("invoice");
    const body: unknown = await req.json().catch(() => null);
    const parsed = invoicePatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid invoice patch", parsed.error.issues);
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) return notFound(`client "${parsed.data.clientId}"`);
    }
    if (parsed.data.status !== undefined) {
      // Status is a lifecycle transition, not a field edit: flipping to
      // "sent" via PATCH would skip marking source tasks/expenses billed.
      return badRequest(
        "Change status via POST /invoices/{id}/send and /invoices/{id}/paid, not PATCH",
      );
    }
    const { lineItems, ...rest } = parsed.data;
    if (lineItems) {
      // Normalize partial line items into full InvoiceLineItems and keep
      // totals consistent unless the caller supplied them explicitly.
      const items: InvoiceLineItem[] = lineItems.map((li) => ({
        id: li.id ?? newId("li"),
        description: li.description,
        quantity: li.quantity,
        rate: li.rate,
        amount: li.amount ?? li.quantity * li.rate,
        ...(li.markupPercent != null ? { markupPercent: li.markupPercent } : {}),
        sourceType: li.sourceType ?? "manual",
        ...(li.sourceId ? { sourceId: li.sourceId } : {}),
        // Per-line tax passes through (PATCH never stamps settings defaults).
        ...(li.taxRate != null ? { taxRate: li.taxRate } : {}),
        ...(li.taxLabel ? { taxLabel: li.taxLabel } : {}),
      }));
      const { subtotal, total } = invoiceTotals(items);
      await provider.updateInvoice(params.id, {
        ...rest,
        lineItems: items,
        subtotal: rest.subtotal ?? subtotal,
        total: rest.total ?? total,
      });
    } else {
      await provider.updateInvoice(params.id, rest);
    }
    const updated = await provider.getInvoice(params.id);
    return ok(updated);
  });
}

async function DELETEHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getInvoice(params.id);
  if (!existing) return notFound("invoice");
  if (existing.status !== "draft") {
    return conflict(
      `Only draft invoices can be deleted (this one is "${existing.status}")`,
      { id: existing.id, status: existing.status },
    );
  }
  // Scheduler-generated drafts claim their sources at generation time
  // (isBilled + invoiceId). Deleting the draft releases those claims so the
  // entries become billable again instead of staying stuck.
  const claimedTasks = (await provider.listTasks()).filter(
    (t) => t.invoiceId === params.id,
  );
  const claimedExpenses = (await provider.listExpenses()).filter(
    (e) => e.invoiceId === params.id,
  );
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: {
        entity: "invoice",
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        total: existing.total,
        status: existing.status,
      },
      wouldUnclaim: {
        taskIds: claimedTasks.map((t) => t.id),
        expenseIds: claimedExpenses.map((e) => e.id),
      },
    });
  }
  for (const t of claimedTasks) {
    await provider.updateTask(t.id, { isBilled: false, invoiceId: undefined });
  }
  for (const e of claimedExpenses) {
    await provider.updateExpense(e.id, { isBilled: false, invoiceId: undefined });
  }
  await provider.removeInvoice(params.id);
  return noContent();
}

export const GET = withApiRequestCache(GETHandler);
export const PATCH = withApiRequestCache(PATCHHandler);
export const DELETE = withApiRequestCache(DELETEHandler);
