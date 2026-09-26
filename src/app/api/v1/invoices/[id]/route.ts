import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { invoicePatchSchema } from "@/server/validation";
import { invoiceTotals } from "@/core/invoice";
import { newId } from "@/core/id";
import type { InvoiceLineItem } from "@/core/entities";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const invoice = await getServerProvider().getInvoice(params.id);
  if (!invoice) return notFound("invoice");
  return ok(invoice);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getInvoice(params.id);
  if (!existing) return notFound("invoice");
  const body: unknown = await req.json().catch(() => null);
  const parsed = invoicePatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid invoice patch", parsed.error.issues);
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
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getInvoice(params.id);
  if (!existing) return notFound("invoice");
  await provider.removeInvoice(params.id);
  return noContent();
}
