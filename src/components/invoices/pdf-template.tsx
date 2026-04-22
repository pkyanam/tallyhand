"use client";

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

const PAGE_PADDING = 40;
const TEXT = "#0a0a0a";
const MUTED = "#737373";
const BORDER = "#e5e5e5";

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
  colAmount: { width: 80, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", marginTop: 10, width: 200 },
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
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    textAlign: "center",
    fontSize: 9,
  },
});

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export function InvoicePdf({
  invoice,
  settings,
  client,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
}) {
  const accent = settings.invoice.accentColor || TEXT;
  const accentStyle = { color: accent };
  const accentBorder = { borderBottomColor: accent, borderTopColor: accent };

  return (
    <Document
      title={`Invoice ${invoice.invoiceNumber}`}
      author={settings.business.name || undefined}
    >
      <Page size="LETTER" style={styles.page}>
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
            {settings.business.email ? (
              <Text style={styles.muted}>{settings.business.email}</Text>
            ) : null}
            {settings.business.taxId ? (
              <Text style={styles.muted}>
                Tax ID: {settings.business.taxId}
              </Text>
            ) : null}
          </View>
          <View style={styles.meta}>
            <Text style={[styles.metaLabel, accentStyle]}>Invoice</Text>
            <Text style={styles.metaNumber}>{invoice.invoiceNumber}</Text>
            <Text style={[styles.muted, { marginTop: 10 }]}>
              Issued {formatDate(invoice.issueDate)}
            </Text>
            <Text style={styles.muted}>Due {formatDate(invoice.dueDate)}</Text>
          </View>
        </View>

        <View>
          <Text style={styles.billToHeading}>Bill to</Text>
          <Text style={styles.billToName}>{client?.name ?? "—"}</Text>
          {client?.email ? (
            <Text style={styles.smallMuted}>{client.email}</Text>
          ) : null}
          {client?.address ? (
            <Text style={styles.smallMuted}>{client.address}</Text>
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={[styles.tableHead, accentBorder]}>
            <Text style={[styles.th, styles.colDescription, accentStyle]}>
              Description
            </Text>
            <Text style={[styles.th, styles.colNumber, accentStyle]}>Qty</Text>
            <Text style={[styles.th, styles.colNumber, accentStyle]}>Rate</Text>
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
              <View key={item.id} style={styles.row}>
                <Text style={styles.colDescription}>
                  {item.description || "—"}
                </Text>
                <Text style={styles.colNumber}>{String(item.quantity)}</Text>
                <Text style={styles.colNumber}>
                  {formatCurrency(item.rate)}
                </Text>
                <Text style={styles.colAmount}>
                  {formatCurrency(item.amount)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{formatCurrency(invoice.subtotal)}</Text>
          </View>
          <View style={[styles.grandTotalRow, accentBorder]}>
            <Text>Total due</Text>
            <Text>{formatCurrency(invoice.total)}</Text>
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Notes</Text>
            <Text style={styles.sectionBody}>{invoice.notes}</Text>
          </View>
        ) : null}

        {settings.business.paymentInstructions ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Payment instructions</Text>
            <Text style={styles.sectionBody}>
              {settings.business.paymentInstructions}
            </Text>
          </View>
        ) : null}

        {settings.invoice.footerText ? (
          <View style={[styles.footer, accentStyle]}>
            <Text>{settings.invoice.footerText}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
