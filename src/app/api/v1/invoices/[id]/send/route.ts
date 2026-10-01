import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../../_lib/sync-auth";
import { notFound, ok } from "@/server/http";
import { withIdempotency } from "../../../_lib/idempotency";
import { conflict } from "../../../_lib/errors";
import { isDryRun } from "../../../_lib/query";

export const runtime = "nodejs";

/**
 * Mark an invoice sent. Idempotent: flips status to "sent" and marks every
 * task/expense referenced by its line items as billed. Safe to retry.
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
  if (invoice.status === "paid") {
    return conflict("Invoice is already paid — it cannot go back to sent", {
      id: invoice.id,
      status: invoice.status,
    });
  }
  if (isDryRun(req)) {
    const taskIds = invoice.lineItems
      .filter((l) => l.sourceType === "task" && l.sourceId)
      .map((l) => l.sourceId as string);
    const expenseIds = invoice.lineItems
      .filter((l) => l.sourceType === "expense" && l.sourceId)
      .map((l) => l.sourceId as string);
    return ok({
      dryRun: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currentStatus: invoice.status,
      wouldSetStatus: "sent",
      wouldMarkBilled: { taskIds, expenseIds },
    });
  }
  return withIdempotency(req, async () => {
    await provider.markInvoiceSent(invoice);
    const updated = await provider.getInvoice(params.id);
    return ok(updated);
  });
}

export const POST = withApiRequestCache(POSTHandler);
