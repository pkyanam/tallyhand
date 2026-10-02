import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf } from "@/components/invoices/pdf-template";
import type { Invoice, Client, Settings } from "@/core/entities";
import { resolveInvoiceQrPayload } from "@/core/invoice";

export async function invoicePdfResponse(invoice: Invoice, settings: Settings, client?: Client | null) {
  // Never fetch user-supplied remote logos while rendering on the server.
  const logo = settings.invoice.logoB64;
  const safeSettings = { ...settings, invoice: { ...settings.invoice, logoB64: logo && logo.length <= 2_000_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(logo) ? logo : undefined } };
  const payload = resolveInvoiceQrPayload(invoice, { businessName: settings.business.name || "" });
  const qrDataUrl = payload ? await (await import("qrcode")).toDataURL(payload, { width: 192, margin: 1 }) : undefined;
  const bytes = await renderToBuffer(<InvoicePdf invoice={invoice} settings={safeSettings} client={client ?? undefined} qrDataUrl={qrDataUrl} />);
  const name = (invoice.invoiceNumber || "invoice").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
