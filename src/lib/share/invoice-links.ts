/** Reusable live invoice links. Reads never publish a new link. */
import type { Invoice } from "@/core/entities";
import type { ShareDeps } from "./service";
import { createShareLink, shareUrl } from "./service";
import { signShareToken } from "@/core/share";

export async function invoiceLinks(deps: ShareDeps, invoice: Invoice, create = false) {
  if (invoice.cloudLinkEnabled === false) return { shareUrl: null, pdfUrl: null };
  const links = await deps.ownerProvider.listShareLinks();
  const active = links.find(link => link.type === "invoice" && link.revokedAt == null && link.expiresAt > Date.now()
    && (link.target as { invoiceId?: string }).invoiceId === invoice.id
    && !(link.target as { snapshot?: unknown }).snapshot);
  let url: string | null = null;
  if (active) url = shareUrl(deps.baseUrl, signShareToken({ v: 1, lid: active.id, typ: "invoice", exp: active.expiresAt }, deps.shareSecret));
  else if (create) url = (await createShareLink(deps, { type: "invoice", target: { invoiceId: invoice.id }, expiresInDays: 365 })).url;
  return { shareUrl: url, pdfUrl: url ? `${url}/pdf` : null };
}

export async function disableInvoiceLinks(deps: ShareDeps, id: string) {
  // Persist the deny flag first: every resolver checks it, even if revocation fails.
  await deps.ownerProvider.updateInvoice(id, { cloudLinkEnabled: false });
  for (const link of await deps.ownerProvider.listShareLinks()) {
    if (link.type === "invoice" && (link.target as { invoiceId?: string }).invoiceId === id && link.revokedAt == null)
      await deps.ownerProvider.revokeShareLink(link.id);
  }
}
