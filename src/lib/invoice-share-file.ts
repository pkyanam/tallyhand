/**
 * Portable invoice share artifact.
 *
 * Tallyhand is local-first: a public link is useless to anyone who cannot
 * reach the machine serving it. The portable answer is a single
 * self-contained `.html` file — all data and styling inlined, zero external
 * requests — that the user can email or message to anyone. It opens in any
 * browser and prints cleanly.
 *
 * Pure and dependency-free (no DOM): `buildShareableInvoiceHtml` returns the
 * file contents as a string; the caller (a client component) turns it into a
 * Blob download. Everything user-supplied is HTML-escaped; URLs and colors
 * are allow-list validated so a hostile/malformed value cannot break out.
 */

import type { Client, Invoice, Settings } from "@/core/entities";
import { formatCurrency } from "./utils";

export interface ShareFileInput {
  invoice: Invoice;
  client?: Client | null;
  settings?: Settings | null;
}

const TEXT = "#111111";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const DEFAULT_ACCENT = "#111111";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only plain hex colors; anything else falls back to the default. */
function safeAccentColor(raw: string | undefined): string {
  if (raw && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw.trim())) {
    return raw.trim();
  }
  return DEFAULT_ACCENT;
}

/**
 * Allow only raster image data URIs of sane size. Rejects `javascript:` /
 * SVG (scriptable) / anything that is not base64 image data.
 */
function safeLogoB64(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length > 2_000_000) return null;
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function formatShareDate(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_STYLE: Record<Invoice["status"], { label: string; fg: string; bg: string }> = {
  draft: { label: "DRAFT", fg: "#57534e", bg: "#f5f5f4" },
  sent: { label: "SENT", fg: "#1d4ed8", bg: "#eff6ff" },
  paid: { label: "PAID", fg: "#047857", bg: "#ecfdf5" },
};

export function buildShareableInvoiceHtml({
  invoice,
  client,
  settings,
}: ShareFileInput): string {
  const business = settings?.business;
  const accent = safeAccentColor(settings?.invoice.accentColor);
  const logo = safeLogoB64(settings?.invoice.logoB64);
  const status = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.draft;
  const items = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f9fafb; color: ${TEXT};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .share-banner { background: #fffbeb; border-bottom: 1px solid #fde68a; color: #92400e;
      font-size: 12px; padding: 8px 16px; text-align: center; }
    .page { max-width: 760px; margin: 32px auto; background: #fff;
      border: 1px solid ${BORDER}; border-radius: 8px; padding: 40px 44px; }
    .header { display: flex; justify-content: space-between; gap: 24px;
      border-bottom: 2px solid ${escapeHtml(accent)}; padding-bottom: 20px; margin-bottom: 24px; }
    .business-name { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
    .muted { color: ${MUTED}; font-size: 13px; margin: 2px 0; }
    .logo { max-width: 160px; max-height: 56px; margin-bottom: 12px; display: block; }
    .meta { text-align: right; flex-shrink: 0; }
    .meta-label { font-size: 11px; letter-spacing: 2px; font-weight: 700; color: ${escapeHtml(accent)}; }
    .meta-number { font-size: 24px; font-weight: 700; margin: 2px 0 8px;
      font-variant-numeric: tabular-nums; }
    .status { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px;
      padding: 2px 10px; border-radius: 999px; margin-bottom: 8px;
      color: ${status.fg}; background: ${status.bg}; }
    .billto-label, .section-label { font-size: 11px; letter-spacing: 2px; font-weight: 700;
      color: ${MUTED}; margin: 0 0 4px; }
    .billto-name { font-size: 16px; font-weight: 700; margin: 0 0 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; font-variant-numeric: tabular-nums; }
    thead th { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; text-align: left;
      color: ${escapeHtml(accent)}; border-bottom: 2px solid ${escapeHtml(accent)};
      padding: 8px 8px 8px 0; }
    thead th.num, tbody td.num { text-align: right; }
    tbody td { padding: 10px 8px 10px 0; border-bottom: 1px solid ${BORDER}; vertical-align: top; }
    .empty { text-align: center; color: ${MUTED}; padding: 24px 0; }
    .totals { width: 240px; margin: 16px 0 0 auto; font-variant-numeric: tabular-nums; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals-label { color: ${MUTED}; }
    .grand { display: flex; justify-content: space-between; font-weight: 700; font-size: 17px;
      border-top: 2px solid ${escapeHtml(accent)}; margin-top: 6px; padding-top: 10px; }
    .section { margin-top: 24px; border-top: 1px solid ${BORDER}; padding-top: 16px; }
    .section p { margin: 4px 0 0; white-space: pre-wrap; }
    .footer { margin-top: 32px; border-top: 1px solid ${BORDER}; padding-top: 16px;
      text-align: center; color: ${escapeHtml(accent)}; font-size: 13px; }
    @page { size: letter; margin: 15mm; }
    @media print {
      body { background: #fff; }
      .share-banner { display: none; }
      .page { margin: 0; max-width: none; border: none; border-radius: 0; padding: 0; }
    }
  `;

  const businessBlock = `
    <div>
      ${logo ? `<img class="logo" alt="" src="${escapeHtml(logo)}" />` : ""}
      <p class="business-name">${escapeHtml(business?.name || "Your business")}</p>
      ${business?.ownerName ? `<p class="muted">${escapeHtml(business.ownerName)}</p>` : ""}
      ${business?.address ? `<p class="muted">${escapeHtml(business.address)}</p>` : ""}
      ${business?.email ? `<p class="muted">${escapeHtml(business.email)}</p>` : ""}
      ${business?.taxId ? `<p class="muted">Tax ID: ${escapeHtml(business.taxId)}</p>` : ""}
    </div>`;

  const rows =
    items.length === 0
      ? `<tr><td colspan="4" class="empty">No line items.</td></tr>`
      : items
          .map(
            (item) => `
        <tr>
          <td>${escapeHtml(item.description || "—")}</td>
          <td class="num">${escapeHtml(String(item.quantity))}</td>
          <td class="num">${escapeHtml(formatCurrency(item.rate))}</td>
          <td class="num">${escapeHtml(formatCurrency(item.amount))}</td>
        </tr>`,
          )
          .join("");

  const title = `Invoice ${invoice.invoiceNumber || ""}`.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="share-banner">Static copy of ${escapeHtml(title)} — exported from Tallyhand. No Tallyhand account needed to view or print this file.</div>
<main class="page">
  <div class="header">
    ${businessBlock}
    <div class="meta">
      <div class="meta-label">INVOICE</div>
      <div class="meta-number">${escapeHtml(invoice.invoiceNumber || "—")}</div>
      <span class="status">${status.label}</span>
      <p class="muted">Issued ${escapeHtml(formatShareDate(invoice.issueDate))}</p>
      <p class="muted">Due ${escapeHtml(formatShareDate(invoice.dueDate))}</p>
    </div>
  </div>

  <div>
    <p class="billto-label">BILL TO</p>
    <p class="billto-name">${escapeHtml(client?.name ?? "—")}</p>
    ${client?.email ? `<p class="muted">${escapeHtml(client.email)}</p>` : ""}
    ${client?.address ? `<p class="muted">${escapeHtml(client.address)}</p>` : ""}
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span class="totals-label">Subtotal</span><span>${escapeHtml(formatCurrency(invoice.subtotal))}</span></div>
    <div class="grand"><span>Total due</span><span>${escapeHtml(formatCurrency(invoice.total))}</span></div>
  </div>

  ${invoice.notes ? `<div class="section"><p class="section-label">NOTES</p><p>${escapeHtml(invoice.notes)}</p></div>` : ""}
  ${business?.paymentInstructions ? `<div class="section"><p class="section-label">PAYMENT INSTRUCTIONS</p><p>${escapeHtml(business.paymentInstructions)}</p></div>` : ""}
  ${settings?.invoice.footerText ? `<div class="footer">${escapeHtml(settings.invoice.footerText)}</div>` : ""}
</main>
</body>
</html>
`;
}

/** Safe download filename for the share artifact, e.g. "inv-0042-invoice.html". */
export function shareInvoiceFileName(invoice: Invoice): string {
  const slug = (invoice.invoiceNumber || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `${slug}-invoice.html` : "invoice.html";
}
