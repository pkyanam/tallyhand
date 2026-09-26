import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { invoiceCreateSchema, type InvoiceCreate } from "@/server/validation";
import { newId, newInvoicePublicToken } from "@/core/id";
import { computeLineAmount, invoiceTotals } from "@/core/invoice";
import type { InvoiceCreateInput, StorageProvider } from "@/core/storage";
import type { InvoiceLineItem } from "@/core/entities";
import {
  aliasedParam,
  applySort,
  filterDateRange,
  parseDateRange,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

const SORT_FIELDS = ["issueDate", "dueDate", "total", "invoiceNumber", "createdAt"] as const;

/**
 * Fill server-side defaults for an invoice create: line-item ids/amounts,
 * subtotal/total, invoice number, status, and public token. Agents may omit
 * anything the server can derive — send line items and we do the math.
 */
async function buildInvoiceInput(
  provider: StorageProvider,
  input: InvoiceCreate,
): Promise<InvoiceCreateInput> {
  const settings = await provider.getSettings();
  const defaultTaxRate = settings.invoice.defaultTaxRate;
  const lineItems: InvoiceLineItem[] = input.lineItems.map((li) => ({
    id: li.id ?? newId("li"),
    description: li.description,
    quantity: li.quantity,
    rate: li.rate,
    amount: li.amount ?? computeLineAmount(li.quantity, li.rate),
    ...(li.markupPercent != null ? { markupPercent: li.markupPercent } : {}),
    sourceType: li.sourceType ?? "manual",
    ...(li.sourceId ? { sourceId: li.sourceId } : {}),
    // Stamp the settings default tax rate onto lines that don't set one.
    ...((() => {
      const taxRate = li.taxRate ?? (defaultTaxRate > 0 ? defaultTaxRate : undefined);
      return taxRate != null ? { taxRate } : {};
    })()),
    ...(li.taxLabel ? { taxLabel: li.taxLabel } : {}),
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
    // -- localization / payment fields (fall back to settings defaults) --
    currency: input.currency ?? settings.invoice.defaultCurrency,
    taxRegion: input.taxRegion ?? settings.invoice.defaultTaxRegion,
    ...(input.sellerTaxId ? { sellerTaxId: input.sellerTaxId } : {}),
    ...(input.sellerTaxIdLabel ? { sellerTaxIdLabel: input.sellerTaxIdLabel } : {}),
    ...(input.buyerTaxId ? { buyerTaxId: input.buyerTaxId } : {}),
    ...(input.sellerEmailVisible != null ? { sellerEmailVisible: input.sellerEmailVisible } : {}),
    ...(input.buyerEmailVisible != null ? { buyerEmailVisible: input.buyerEmailVisible } : {}),
    ...(input.serviceStart != null ? { serviceStart: input.serviceStart } : {}),
    ...(input.serviceEnd != null ? { serviceEnd: input.serviceEnd } : {}),
    ...(input.invoiceType ? { invoiceType: input.invoiceType } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(input.paymentUrl ? { paymentUrl: input.paymentUrl } : {}),
    ...(input.bankAccount ? { bankAccount: input.bankAccount } : {}),
    ...(input.swiftBic ? { swiftBic: input.swiftBic } : {}),
    ...(input.qrEnabled != null ? { qrEnabled: input.qrEnabled } : {}),
    ...(input.qrPayload ? { qrPayload: input.qrPayload } : {}),
    ...(input.qrDescription ? { qrDescription: input.qrDescription } : {}),
    ...(input.amountInWords != null ? { amountInWords: input.amountInWords } : {}),
    ...(input.template ? { template: input.template } : {}),
  };
}

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const clientId = aliasedParam(search, "clientId", "client_id");
  const status = search.get("status");
  const overdue = search.get("overdue") === "true";

  const range = parseDateRange(req);
  if (range === "invalid") {
    return badRequest("date_from/date_to must be ms epoch or ISO-8601 dates");
  }
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }

  let invoices = await provider.listInvoices();
  if (clientId) invoices = invoices.filter((i) => i.clientId === clientId);
  if (status === "draft" || status === "sent" || status === "paid") {
    invoices = invoices.filter((i) => i.status === status);
  }
  if (overdue) {
    const now = Date.now();
    invoices = invoices.filter((i) => i.status === "sent" && i.dueDate < now);
  }
  invoices = filterDateRange(invoices, (i) => i.issueDate, range);
  if (sort) invoices = applySort(invoices, sort);

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
    if (parsed.data.status && parsed.data.status !== "draft") {
      return badRequest(
        'Invoices are always created as drafts — change status via POST /invoices/{id}/send and /paid',
      );
    }
    const invoice = await provider.createInvoice(
      await buildInvoiceInput(provider, parsed.data),
    );
    return created(invoice);
  });
}
