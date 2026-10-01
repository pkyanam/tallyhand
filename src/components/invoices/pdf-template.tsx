"use client";

import { billingEmailDisplay } from "@/core/billing-emails";
import * as React from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { Client, Invoice, Settings } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";
import {
  invoicePdfModel,
  type InvoicePdfModel,
} from "./invoice-pdf-model";

const PAGE_PADDING = 40;
const TEXT = "#0a0a0a";
const MUTED = "#737373";
const BORDER = "#e5e5e5";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function formatServicePeriod(
  period: NonNullable<InvoicePdfModel["servicePeriod"]>,
): string {
  const { start, end } = period;
  if (start != null && end != null)
    return `${formatDate(start)} – ${formatDate(end)}`;
  if (start != null) return `from ${formatDate(start)}`;
  return `through ${formatDate(end!)}`;
}

function money(amount: number, currency: string): string {
  return formatCurrency(amount, currency);
}

// ---------------------------------------------------------------------------
// Default template (legacy look, extended with the new invoice fields)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingBottom: PAGE_PADDING,
    paddingLeft: PAGE_PADDING,
    paddingRight: PAGE_PADDING,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: TEXT,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 16,
    marginBottom: 16,
  },
  businessName: { fontSize: 14, fontWeight: 700 },
  meta: { textAlign: "right" },
  metaLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  metaNumber: {
    fontSize: 16,
    marginTop: 2,
    fontFamily: "Helvetica",
  },
  muted: { color: MUTED, fontSize: 9, marginTop: 2 },
  smallMuted: { color: MUTED, fontSize: 9 },
  billToHeading: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
    color: MUTED,
  },
  billToName: { fontWeight: 700, marginTop: 2, fontSize: 11 },
  logo: { maxWidth: 140, maxHeight: 48, marginBottom: 8, objectFit: "contain" },
  table: { marginTop: 20 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingBottom: 6,
    marginBottom: 4,
  },
  th: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  colDescription: { flex: 1, paddingRight: 8 },
  colNumber: { width: 60, textAlign: "right", paddingRight: 8 },
  colTax: { width: 56, textAlign: "right", paddingRight: 8 },
  colAmount: { width: 80, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", marginTop: 10, width: 220 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsLabel: { color: MUTED },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    borderTopWidth: 1,
    fontWeight: 700,
    fontSize: 12,
    marginTop: 4,
  },
  amountWords: {
    marginTop: 6,
    textAlign: "right",
    color: MUTED,
    fontSize: 9,
    fontStyle: "italic",
  },
  section: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  sectionHeading: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
    color: MUTED,
  },
  sectionBody: { marginTop: 4, fontSize: 10 },
  qrBlock: { marginTop: 20, alignItems: "center" },
  qrImage: { width: 96, height: 96 },
  qrCaption: { marginTop: 6, color: MUTED, fontSize: 9, textAlign: "center" },
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    textAlign: "center",
    fontSize: 9,
  },
});

function PaymentSection({ model }: { model: InvoicePdfModel }) {
  if (!model.hasPaymentBlock) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>Payment</Text>
      <View style={styles.sectionBody}>
        {model.paymentMethod ? (
          <Text>{model.paymentMethod}</Text>
        ) : null}
        {model.paymentUrl ? (
          <Text style={styles.muted}>{model.paymentUrl}</Text>
        ) : null}
        {model.bankAccount ? (
          <Text>
            {model.bankAccountLabel}: {model.bankAccount}
          </Text>
        ) : null}
        {model.swiftBic ? (
          <Text>SWIFT/BIC: {model.swiftBic}</Text>
        ) : null}
      </View>
    </View>
  );
}

function QrBlock({
  model,
  qrDataUrl,
}: {
  model: InvoicePdfModel;
  qrDataUrl?: string;
}) {
  if (!qrDataUrl) return null;
  return (
    <View style={styles.qrBlock}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={qrDataUrl} style={styles.qrImage} />
      {model.qrDescription ? (
        <Text style={styles.qrCaption}>{model.qrDescription}</Text>
      ) : null}
    </View>
  );
}

function DefaultInvoicePage({
  invoice,
  settings,
  client,
  qrDataUrl,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
  qrDataUrl?: string;
}) {
  const model = invoicePdfModel(invoice, settings, client);
  const accent = settings.invoice.accentColor || TEXT;
  const accentStyle = { color: accent };
  const accentBorder = { borderBottomColor: accent, borderTopColor: accent };

  return (
    <Page size={model.pageSize} style={styles.page}>
      <View style={styles.header}>
        <View style={{ flex: 1, paddingRight: 24 }}>
          {settings.invoice.logoB64 ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={settings.invoice.logoB64} style={styles.logo} />
          ) : null}
          <Text style={styles.businessName}>
            {settings.business.name || "Your business"}
          </Text>
          {settings.business.ownerName ? (
            <Text style={styles.muted}>{settings.business.ownerName}</Text>
          ) : null}
          {settings.business.address ? (
            <Text style={styles.muted}>{settings.business.address}</Text>
          ) : null}
          {billingEmailDisplay(settings.business) && model.showSellerEmail ? (
            <Text style={styles.muted}>{billingEmailDisplay(settings.business)}</Text>
          ) : null}
          {model.sellerTaxId ? (
            <Text style={styles.muted}>
              {model.sellerTaxIdLabel}: {model.sellerTaxId}
            </Text>
          ) : null}
        </View>
        <View style={styles.meta}>
          <Text style={[styles.metaLabel, accentStyle]}>
            {model.documentType}
          </Text>
          <Text style={styles.metaNumber}>{invoice.invoiceNumber}</Text>
          <Text style={[styles.muted, { marginTop: 10 }]}>
            Issued {formatDate(invoice.issueDate)}
          </Text>
          <Text style={styles.muted}>Due {formatDate(invoice.dueDate)}</Text>
          {model.servicePeriod ? (
            <Text style={styles.muted}>
              Service {formatServicePeriod(model.servicePeriod)}
            </Text>
          ) : null}
        </View>
      </View>

      <View>
        <Text style={styles.billToHeading}>Bill to</Text>
        <Text style={styles.billToName}>{client?.name ?? "—"}</Text>
        {client?.email && model.showBuyerEmail ? (
          <Text style={styles.smallMuted}>{client.email}</Text>
        ) : null}
        {client?.address ? (
          <Text style={styles.smallMuted}>{client.address}</Text>
        ) : null}
        {model.buyerTaxId ? (
          <Text style={styles.smallMuted}>
            {model.buyerTaxIdLabel}: {model.buyerTaxId}
          </Text>
        ) : null}
      </View>

      <View style={styles.table}>
        <View style={[styles.tableHead, accentBorder]}>
          <Text style={[styles.th, styles.colDescription, accentStyle]}>
            Description
          </Text>
          <Text style={[styles.th, styles.colNumber, accentStyle]}>Qty</Text>
          <Text style={[styles.th, styles.colNumber, accentStyle]}>Rate</Text>
          {model.hasTaxColumn ? (
            <Text style={[styles.th, styles.colTax, accentStyle]}>
              {model.taxLabel}
            </Text>
          ) : null}
          <Text style={[styles.th, styles.colAmount, accentStyle]}>
            Amount
          </Text>
        </View>
        {invoice.lineItems.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <Text style={styles.smallMuted}>No line items.</Text>
          </View>
        ) : (
          invoice.lineItems.map((item) => (
            <View key={item.id} style={styles.row} wrap={false}>
              <Text style={styles.colDescription}>
                {item.description || "—"}
              </Text>
              <Text style={styles.colNumber}>{String(item.quantity)}</Text>
              <Text style={styles.colNumber}>
                {money(item.rate, model.currency)}
              </Text>
              {model.hasTaxColumn ? (
                <Text style={styles.colTax}>
                  {item.taxRate ? `${item.taxRate}%` : "—"}
                </Text>
              ) : null}
              <Text style={styles.colAmount}>
                {money(item.amount, model.currency)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.totalsBlock}>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Subtotal</Text>
          <Text>{money(model.subtotal, model.currency)}</Text>
        </View>
        {model.taxGroups.map((group) => (
          <View key={group.rate} style={styles.totalsRow} wrap={false}>
            <Text style={styles.totalsLabel}>{group.label}</Text>
            <Text>{money(group.tax, model.currency)}</Text>
          </View>
        ))}
        <View style={[styles.grandTotalRow, accentBorder]}>
          <Text>Total due</Text>
          <Text>{money(model.total, model.currency)}</Text>
        </View>
      </View>
      {model.amountInWordsText ? (
        <Text style={styles.amountWords}>{model.amountInWordsText}</Text>
      ) : null}

      {invoice.notes ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Notes</Text>
          <Text style={styles.sectionBody}>{invoice.notes}</Text>
        </View>
      ) : null}

      <PaymentSection model={model} />

      {settings.business.paymentInstructions ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Payment instructions</Text>
          <Text style={styles.sectionBody}>
            {settings.business.paymentInstructions}
          </Text>
        </View>
      ) : null}

      <QrBlock model={model} qrDataUrl={qrDataUrl} />

      {settings.invoice.footerText ? (
        <View style={[styles.footer, accentStyle]}>
          <Text>{settings.invoice.footerText}</Text>
        </View>
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Stripe template: restrained, no accent color, larger total, airier spacing
// ---------------------------------------------------------------------------

const stripeStyles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 48,
    paddingRight: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: TEXT,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  businessName: { fontSize: 18, fontWeight: 700 },
  muted: { color: MUTED, fontSize: 9, marginTop: 3 },
  meta: { textAlign: "right" },
  docType: { fontSize: 22, fontWeight: 700 },
  docNumber: { fontSize: 12, marginTop: 4 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 3,
  },
  metaKey: { color: MUTED, fontSize: 9, marginRight: 6 },
  metaValue: { fontSize: 9 },
  partyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  partyLabel: { fontSize: 9, color: MUTED, marginBottom: 4 },
  partyName: { fontWeight: 700, fontSize: 11 },
  partyLine: { fontSize: 9, color: MUTED, marginTop: 2 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: TEXT,
    paddingBottom: 8,
    marginBottom: 2,
  },
  th: { fontSize: 9, fontWeight: 700 },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  colDescription: { flex: 1, paddingRight: 12 },
  colNumber: { width: 56, textAlign: "right", paddingRight: 8 },
  colTax: { width: 56, textAlign: "right", paddingRight: 8 },
  colAmount: { width: 90, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", marginTop: 16, width: 240 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalsLabel: { color: MUTED },
  grandTotal: { fontSize: 18, fontWeight: 700 },
  amountWords: {
    marginTop: 8,
    textAlign: "right",
    color: MUTED,
    fontSize: 9,
    fontStyle: "italic",
  },
  section: { marginTop: 28 },
  sectionHeading: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  sectionBody: { fontSize: 10, color: MUTED },
  bodyLine: { marginTop: 2 },
  qrBlock: { marginTop: 28, alignItems: "center" },
  qrImage: { width: 104, height: 104 },
  qrCaption: { marginTop: 6, color: MUTED, fontSize: 9, textAlign: "center" },
  footer: { marginTop: 32, textAlign: "center", fontSize: 9, color: MUTED },
});

function StripeInvoicePage({
  invoice,
  settings,
  client,
  qrDataUrl,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
  qrDataUrl?: string;
}) {
  const model = invoicePdfModel(invoice, settings, client);

  return (
    <Page size={model.pageSize} style={stripeStyles.page}>
      <View style={stripeStyles.header}>
        <View style={{ flex: 1, paddingRight: 24 }}>
          {settings.invoice.logoB64 ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={settings.invoice.logoB64}
              style={{ maxWidth: 140, maxHeight: 48, marginBottom: 10, objectFit: "contain" }}
            />
          ) : null}
          <Text style={stripeStyles.businessName}>
            {settings.business.name || "Your business"}
          </Text>
          {settings.business.ownerName ? (
            <Text style={stripeStyles.muted}>{settings.business.ownerName}</Text>
          ) : null}
          {settings.business.address ? (
            <Text style={stripeStyles.muted}>{settings.business.address}</Text>
          ) : null}
          {billingEmailDisplay(settings.business) && model.showSellerEmail ? (
            <Text style={stripeStyles.muted}>{billingEmailDisplay(settings.business)}</Text>
          ) : null}
          {model.sellerTaxId ? (
            <Text style={stripeStyles.muted}>
              {model.sellerTaxIdLabel}: {model.sellerTaxId}
            </Text>
          ) : null}
        </View>
        <View style={stripeStyles.meta}>
          <Text style={stripeStyles.docType}>{model.documentType}</Text>
          <Text style={stripeStyles.docNumber}>{invoice.invoiceNumber}</Text>
          <View style={[stripeStyles.metaRow, { marginTop: 10 }]}>
            <Text style={stripeStyles.metaKey}>Issued</Text>
            <Text style={stripeStyles.metaValue}>
              {formatDate(invoice.issueDate)}
            </Text>
          </View>
          <View style={stripeStyles.metaRow}>
            <Text style={stripeStyles.metaKey}>Due</Text>
            <Text style={stripeStyles.metaValue}>
              {formatDate(invoice.dueDate)}
            </Text>
          </View>
          {model.servicePeriod ? (
            <View style={stripeStyles.metaRow}>
              <Text style={stripeStyles.metaKey}>Service</Text>
              <Text style={stripeStyles.metaValue}>
                {formatServicePeriod(model.servicePeriod)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={stripeStyles.partyRow}>
        <View style={{ flex: 1, paddingRight: 24 }}>
          <Text style={stripeStyles.partyLabel}>Billed to</Text>
          <Text style={stripeStyles.partyName}>{client?.name ?? "—"}</Text>
          {client?.email && model.showBuyerEmail ? (
            <Text style={stripeStyles.partyLine}>{client.email}</Text>
          ) : null}
          {client?.address ? (
            <Text style={stripeStyles.partyLine}>{client.address}</Text>
          ) : null}
          {model.buyerTaxId ? (
            <Text style={stripeStyles.partyLine}>
              {model.buyerTaxIdLabel}: {model.buyerTaxId}
            </Text>
          ) : null}
        </View>
      </View>

      <View>
        <View style={stripeStyles.tableHead}>
          <Text style={[stripeStyles.th, stripeStyles.colDescription]}>
            Description
          </Text>
          <Text style={[stripeStyles.th, stripeStyles.colNumber]}>Qty</Text>
          <Text style={[stripeStyles.th, stripeStyles.colNumber]}>Rate</Text>
          {model.hasTaxColumn ? (
            <Text style={[stripeStyles.th, stripeStyles.colTax]}>
              {model.taxLabel}
            </Text>
          ) : null}
          <Text style={[stripeStyles.th, stripeStyles.colAmount]}>Amount</Text>
        </View>
        {invoice.lineItems.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <Text style={stripeStyles.muted}>No line items.</Text>
          </View>
        ) : (
          invoice.lineItems.map((item) => (
            <View key={item.id} style={stripeStyles.row} wrap={false}>
              <Text style={stripeStyles.colDescription}>
                {item.description || "—"}
              </Text>
              <Text style={stripeStyles.colNumber}>{String(item.quantity)}</Text>
              <Text style={stripeStyles.colNumber}>
                {money(item.rate, model.currency)}
              </Text>
              {model.hasTaxColumn ? (
                <Text style={stripeStyles.colTax}>
                  {item.taxRate ? `${item.taxRate}%` : "—"}
                </Text>
              ) : null}
              <Text style={stripeStyles.colAmount}>
                {money(item.amount, model.currency)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={stripeStyles.totalsBlock}>
        <View style={stripeStyles.totalsRow}>
          <Text style={stripeStyles.totalsLabel}>Subtotal</Text>
          <Text>{money(model.subtotal, model.currency)}</Text>
        </View>
        {model.taxGroups.map((group) => (
          <View key={group.rate} style={stripeStyles.totalsRow} wrap={false}>
            <Text style={stripeStyles.totalsLabel}>{group.label}</Text>
            <Text>{money(group.tax, model.currency)}</Text>
          </View>
        ))}
        <View style={[stripeStyles.totalsRow, { marginTop: 8 }]}>
          <Text style={stripeStyles.grandTotal}>Total</Text>
          <Text style={stripeStyles.grandTotal}>
            {money(model.total, model.currency)}
          </Text>
        </View>
        {model.amountInWordsText ? (
          <Text style={stripeStyles.amountWords}>
            {model.amountInWordsText}
          </Text>
        ) : null}
      </View>

      {invoice.notes ? (
        <View style={stripeStyles.section}>
          <Text style={stripeStyles.sectionHeading}>Notes</Text>
          <Text style={stripeStyles.sectionBody}>{invoice.notes}</Text>
        </View>
      ) : null}

      {model.hasPaymentBlock ? (
        <View style={stripeStyles.section}>
          <Text style={stripeStyles.sectionHeading}>Payment</Text>
          <View style={stripeStyles.sectionBody}>
            {model.paymentMethod ? (
              <Text style={stripeStyles.bodyLine}>{model.paymentMethod}</Text>
            ) : null}
            {model.paymentUrl ? (
              <Text style={stripeStyles.bodyLine}>{model.paymentUrl}</Text>
            ) : null}
            {model.bankAccount ? (
              <Text style={stripeStyles.bodyLine}>
                {model.bankAccountLabel}: {model.bankAccount}
              </Text>
            ) : null}
            {model.swiftBic ? (
              <Text style={stripeStyles.bodyLine}>
                SWIFT/BIC: {model.swiftBic}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {settings.business.paymentInstructions ? (
        <View style={stripeStyles.section}>
          <Text style={stripeStyles.sectionHeading}>Payment instructions</Text>
          <Text style={stripeStyles.sectionBody}>
            {settings.business.paymentInstructions}
          </Text>
        </View>
      ) : null}

      {qrDataUrl ? (
        <View style={stripeStyles.qrBlock}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={qrDataUrl} style={stripeStyles.qrImage} />
          {model.qrDescription ? (
            <Text style={stripeStyles.qrCaption}>{model.qrDescription}</Text>
          ) : null}
        </View>
      ) : null}

      {settings.invoice.footerText ? (
        <View style={stripeStyles.footer}>
          <Text>{settings.invoice.footerText}</Text>
        </View>
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------

export function InvoicePdf({
  invoice,
  settings,
  client,
  qrDataUrl,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
  /** PNG data URL for the payment QR code (generated by the caller; async). */
  qrDataUrl?: string;
}) {
  const template = invoice.template ?? "default";
  return (
    <Document
      title={`${invoice.invoiceType?.trim() || "Invoice"} ${invoice.invoiceNumber}`}
      author={settings.business.name || undefined}
    >
      {template === "stripe" ? (
        <StripeInvoicePage
          invoice={invoice}
          settings={settings}
          client={client}
          qrDataUrl={qrDataUrl}
        />
      ) : (
        <DefaultInvoicePage
          invoice={invoice}
          settings={settings}
          client={client}
          qrDataUrl={qrDataUrl}
        />
      )}
    </Document>
  );
}
