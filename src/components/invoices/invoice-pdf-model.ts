// Pure display model for invoice rendering (PDF + HTML preview).
// Resolves every optional invoice localization/payment field into concrete
// display values. Invoices without the new fields resolve exactly to the
// legacy behavior (USD, LETTER, "Sales tax", "Tax ID", no tax rows, no QR).

import {
  amountInWords,
  defaultTaxIdLabelForRegion,
  invoiceTaxTotals,
  pageSizeForRegion,
  resolveInvoiceCurrency,
  resolveInvoiceQrPayload,
  resolveInvoiceTaxRegion,
  resolveSellerTaxIdLabel,
  taxLabelForRegion,
  type InvoiceTaxTotals,
} from "@/core/invoice";
import type { Client, Invoice, Settings, TaxRegion } from "@/lib/db/types";

export interface InvoicePdfTaxGroupRow {
  /** Tax rate percent for this group. */
  rate: number;
  /**
   * Resolved display label: the group's uniform per-line `taxLabel` when
   * every line in the group set the same one, otherwise the region-aware
   * fallback like "Sales tax (8.5%)" / "VAT (20%)".
   */
  label: string;
  /** Sum of line amounts this tax applies to. */
  taxable: number;
  /** Sum of tax for this group. */
  tax: number;
}

export interface InvoicePdfModel {
  /** ISO 4217 code, uppercased. */
  currency: string;
  region: TaxRegion;
  pageSize: "LETTER" | "A4";
  /** Document type heading: invoice.invoiceType ?? "Invoice". */
  documentType: string;
  /** "Sales tax" for US, "VAT" for EU. */
  taxLabel: string;
  /** Resolved seller tax-ID label (invoice → settings → region default). */
  sellerTaxIdLabel: string;
  /** Buyer tax-ID label: "VAT ID" for EU, "Tax ID" for US. */
  buyerTaxIdLabel: string;
  /** True when at least one line carries a tax rate → render the tax column. */
  hasTaxColumn: boolean;
  /** True when there are tax groups to render as summary rows. */
  hasTaxRows: boolean;
  subtotal: number;
  taxTotal: number;
  total: number;
  taxGroups: InvoicePdfTaxGroupRow[];
  /** Spelled-out total, or null when amount-in-words is disabled. */
  amountInWordsText: string | null;
  /** QR payload text, or null when QR is disabled/absent. */
  qrPayload: string | null;
  /** Human-readable caption shown under the QR code. */
  qrDescription?: string;
  showSellerEmail: boolean;
  showBuyerEmail: boolean;
  /** Effective seller tax ID (invoice override → settings), or null. */
  sellerTaxId: string | null;
  /** Buyer tax ID, or null. */
  buyerTaxId: string | null;
  /** "IBAN" for EU invoices, "Account" otherwise. */
  bankAccountLabel: string;
  /** Service period, resolved only when at least one bound is set. */
  servicePeriod: { start?: number; end?: number } | null;
  /** Payment block fields. */
  paymentMethod: string | null;
  paymentUrl: string | null;
  bankAccount: string | null;
  swiftBic: string | null;
  /** True when the invoice carries any payment-block field. */
  hasPaymentBlock: boolean;
  /** "default" or "stripe". */
  template: "default" | "stripe";
}

function nonEmpty(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Build the full display model for an invoice. Pure — no rendering here.
 * Legacy invoices (none of the optional localization/payment fields set)
 * resolve to: USD, LETTER, "Sales tax", "Tax ID", stored subtotal/total,
 * no tax rows, no amount-in-words, no QR.
 */
export function invoicePdfModel(
  invoice: Invoice,
  settings: Settings,
  client?: Client,
): InvoicePdfModel {
  const region = resolveInvoiceTaxRegion(
    invoice,
    settings.invoice.defaultTaxRegion,
  );
  const currency = resolveInvoiceCurrency(
    invoice,
    nonEmpty(settings.invoice.defaultCurrency) ?? undefined,
  );
  const taxLabel = taxLabelForRegion(region);

  const computed: InvoiceTaxTotals = invoiceTaxTotals(invoice.lineItems);
  // Legacy invoices (no tax rates) keep the stored totals exactly.
  const hasTaxRows = computed.groups.length > 0;
  const subtotal = hasTaxRows ? computed.subtotal : invoice.subtotal;
  const total = hasTaxRows ? computed.total : invoice.total;

  const taxGroups: InvoicePdfTaxGroupRow[] = computed.groups.map((group) => ({
    rate: group.rate,
    label: group.label ?? `${taxLabel} (${group.rate}%)`,
    taxable: group.taxable,
    tax: group.tax,
  }));
  const hasTaxColumn = invoice.lineItems.some(
    (line) => (line.taxRate ?? 0) !== 0,
  );

  const amountInWordsEnabled =
    invoice.amountInWords ?? settings.invoice.amountInWordsDefault ?? false;

  const qrPayload = resolveInvoiceQrPayload(invoice, {
    businessName: settings.business.name || "",
  });

  // An empty settings label means "use the region default"; a non-empty one
  // is an explicit choice that wins over the region default.
  const settingsTaxIdLabel = nonEmpty(settings.invoice.taxIdLabel);

  const servicePeriod =
    invoice.serviceStart != null || invoice.serviceEnd != null
      ? { start: invoice.serviceStart, end: invoice.serviceEnd }
      : null;

  const paymentMethod = nonEmpty(invoice.paymentMethod);
  const paymentUrl = nonEmpty(invoice.paymentUrl);
  const bankAccount = nonEmpty(invoice.bankAccount);
  const swiftBic = nonEmpty(invoice.swiftBic);

  // `client` is accepted for call-site symmetry (renderers still need it for
  // name/email/address); the model itself carries no client-derived values.
  void client;

  return {
    currency,
    region,
    pageSize: pageSizeForRegion(region),
    documentType: nonEmpty(invoice.invoiceType) ?? "Invoice",
    taxLabel,
    sellerTaxIdLabel: resolveSellerTaxIdLabel(
      invoice,
      settingsTaxIdLabel ?? undefined,
    ),
    buyerTaxIdLabel: defaultTaxIdLabelForRegion(region),
    hasTaxColumn,
    hasTaxRows,
    subtotal,
    taxTotal: computed.taxTotal,
    total,
    taxGroups,
    amountInWordsText: amountInWordsEnabled
      ? amountInWords(total, currency)
      : null,
    qrPayload,
    qrDescription: nonEmpty(invoice.qrDescription) ?? undefined,
    showSellerEmail: invoice.sellerEmailVisible ?? true,
    showBuyerEmail: invoice.buyerEmailVisible ?? true,
    sellerTaxId: nonEmpty(invoice.sellerTaxId) ?? nonEmpty(settings.business.taxId),
    buyerTaxId: nonEmpty(invoice.buyerTaxId),
    bankAccountLabel: region === "EU" ? "IBAN" : "Account",
    servicePeriod,
    paymentMethod,
    paymentUrl,
    bankAccount,
    swiftBic,
    hasPaymentBlock:
      paymentMethod !== null ||
      paymentUrl !== null ||
      bankAccount !== null ||
      swiftBic !== null,
    template: invoice.template ?? "default",
  };
}
