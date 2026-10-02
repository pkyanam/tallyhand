import type { Invoice } from "@/core/entities";
import { getShareDeps } from "@/lib/share/server-deps";
import { invoiceLinks, disableInvoiceLinks } from "@/lib/share/invoice-links";

/** Preserve the saved invoice even if the optional hosted sharing service is unavailable. */
export async function withInvoiceLinks(invoice: Invoice, create = false) {
  const authenticatedPdfPath = `/api/v1/invoices/${encodeURIComponent(invoice.id)}/pdf`;
  if (invoice.cloudLinkEnabled === false && !create) return { ...invoice, shareUrl: null, pdfUrl: null, authenticatedPdfPath };
  try {
    const deps = getShareDeps();
    if (create && invoice.cloudLinkEnabled === false) await disableInvoiceLinks(deps, invoice.id);
    return { ...invoice, ...await invoiceLinks(deps, invoice, create), authenticatedPdfPath };
  } catch {
    return { ...invoice, shareUrl: null, pdfUrl: null, authenticatedPdfPath,
      sharingWarning: "Cloud links unavailable; check hosted sharing configuration or retry enabling its link." };
  }
}
