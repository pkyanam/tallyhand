import { withInvoiceLinks } from "@/server/invoice-links";
import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../../_lib/sync-auth";
import { notFound, ok } from "@/server/http";
import { withIdempotency } from "../../../_lib/idempotency";
import { conflict } from "../../../_lib/errors";
import { isDryRun } from "../../../_lib/query";

export const runtime = "nodejs";

/**
 * Mark an invoice paid. Idempotent — safe to retry.
 * `?dry_run=true` returns what would change without mutating. Dry-run
 * responses are never stored under an Idempotency-Key.
 */
async function POSTHandler(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const invoice = await provider.getInvoice(params.id);
  if (!invoice) return notFound("invoice");
  if (invoice.status === "draft") {
    return conflict("Invoice must be sent before it can be marked paid", {
      id: invoice.id,
      status: invoice.status,
    });
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currentStatus: invoice.status,
      wouldSetStatus: "paid",
      total: invoice.total,
    });
  }
  return withIdempotency(req, async () => {
    await provider.markInvoicePaid(params.id);
    const updated = await provider.getInvoice(params.id);
    return ok(updated ? await withInvoiceLinks(updated) : updated);
  });
}

export const POST = withApiRequestCache(POSTHandler);
