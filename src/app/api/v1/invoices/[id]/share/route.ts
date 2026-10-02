import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiOrSession } from "../../../_lib/sync-auth";
import { getShareDeps } from "@/lib/share/server-deps";
import { invoiceLinks, disableInvoiceLinks } from "@/lib/share/invoice-links";
import { badRequest, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../../_lib/idempotency";
export const runtime = "nodejs";
export const POST = withApiRequestCache(async (req: Request, { params }: { params: { id: string } }) => {
  const denied = await requireApiOrSession(req); if (denied) return denied;
  const input = await req.clone().json().catch(() => null);
  if (typeof input?.enabled !== "boolean") return badRequest("enabled must be a boolean");
  return withIdempotency(req, async () => {
    const deps = getShareDeps();
    const invoice = await deps.ownerProvider.getInvoice(params.id); if (!invoice) return notFound("invoice");
    if (!input.enabled) { await disableInvoiceLinks(deps, invoice.id); return ok({ cloudLinkEnabled: false, shareUrl: null, pdfUrl: null }); }
    if (invoice.cloudLinkEnabled === false) await disableInvoiceLinks(deps, invoice.id);
    await deps.ownerProvider.updateInvoice(invoice.id, { cloudLinkEnabled: true });
    return ok({ cloudLinkEnabled: true, ...await invoiceLinks(deps, { ...invoice, cloudLinkEnabled: true }, true) });
  });
});
