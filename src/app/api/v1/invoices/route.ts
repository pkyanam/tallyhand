import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { invoiceCreateSchema, type InvoiceCreate } from "@/server/validation";
import { newId, newInvoicePublicToken } from "@/core/id";
import { computeLineAmount, invoiceTotals } from "@/core/invoice";
import type { InvoiceCreateInput, StorageProvider } from "@/core/storage";
import type { InvoiceLineItem } from "@/core/entities";

/**
 * Fill server-side defaults for an invoice create: line-item ids/amounts,
 * subtotal/total, invoice number, status, and public token. Agents may omit
 * anything the server can derive — send line items and we do the math.
 */
async function buildInvoiceInput(
  provider: StorageProvider,
  input: InvoiceCreate,
): Promise<InvoiceCreateInput> {
  const lineItems: InvoiceLineItem[] = input.lineItems.map((li) => ({
    id: li.id ?? newId("li"),
    description: li.description,
    quantity: li.quantity,
    rate: li.rate,
    amount: li.amount ?? computeLineAmount(li.quantity, li.rate),
    ...(li.markupPercent != null ? { markupPercent: li.markupPercent } : {}),
    sourceType: li.sourceType ?? "manual",
    ...(li.sourceId ? { sourceId: li.sourceId } : {}),
  }));
  const { subtotal, total } = invoiceTotals(lineItems);
  return {
    ...(input.id ? { id: input.id } : {}),
    clientId: input.clientId,
    invoiceNumber: input.invoiceNumber ?? (await provider.assignNextInvoiceNumber()),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    status: input.status ?? "draft",
    lineItems,
    subtotal: input.subtotal ?? subtotal,
    total: input.total ?? total,
    ...(input.notes ? { notes: input.notes } : {}),
    publicToken: input.publicToken ?? newInvoicePublicToken(),
  };
}

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const clientId = search.get("clientId");
  const status = search.get("status");

  let invoices = await provider.listInvoices();
  if (clientId) invoices = invoices.filter((i) => i.clientId === clientId);
  if (status === "draft" || status === "sent" || status === "paid") {
    invoices = invoices.filter((i) => i.status === status);
  }

  return paginated(invoices, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = invoiceCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid invoice", parsed.error.issues);
    }
    const provider = getServerProvider();
    const client = await provider.getClient(parsed.data.clientId);
    if (!client) {
      return badRequest(`clientId "${parsed.data.clientId}" does not exist`);
    }
    if (parsed.data.dueDate < parsed.data.issueDate) {
      return badRequest("dueDate must be >= issueDate");
    }
    const invoice = await provider.createInvoice(
      await buildInvoiceInput(provider, parsed.data),
    );
    return created(invoice);
  });
}
