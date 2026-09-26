"use client";

import * as React from "react";
import type { Client, Invoice, Settings } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";
import { invoicePdfModel } from "./invoice-pdf-model";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export function InvoicePreview({
  invoice,
  settings,
  client,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
}) {
  const accent =
    settings.invoice.accentColor?.trim() || "hsl(var(--foreground))";
  const model = invoicePdfModel(invoice, settings, client);
  const colCount = model.hasTaxColumn ? 5 : 4;
  const servicePeriod =
    model.servicePeriod?.start != null && model.servicePeriod?.end != null
      ? `${formatDate(model.servicePeriod.start)} – ${formatDate(model.servicePeriod.end)}`
      : model.servicePeriod?.start != null
        ? `from ${formatDate(model.servicePeriod.start)}`
        : model.servicePeriod?.end != null
          ? `through ${formatDate(model.servicePeriod.end)}`
          : null;

  return (
    <div
      className="rounded-lg border bg-background p-6 text-sm"
      style={{ minHeight: 600 }}
    >
      <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
        <div className="min-w-0 max-w-[60%]">
          {settings.invoice.logoB64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.invoice.logoB64}
              alt=""
              className="mb-3 max-h-14 w-auto"
            />
          ) : null}
          <h2 className="text-lg font-semibold">
            {settings.business.name || "Your business"}
          </h2>
          {settings.business.ownerName ? (
            <p className="text-xs text-muted-foreground">
              {settings.business.ownerName}
            </p>
          ) : null}
          {settings.business.address ? (
            <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
              {settings.business.address}
            </div>
          ) : null}
          {settings.business.email && model.showSellerEmail ? (
            <div className="text-xs text-muted-foreground">
              {settings.business.email}
            </div>
          ) : null}
          {model.sellerTaxId ? (
            <div className="text-xs text-muted-foreground">
              {model.sellerTaxIdLabel}: {model.sellerTaxId}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div
            className="text-xs font-medium uppercase tracking-widest"
            style={{ color: accent }}
          >
            {model.documentType}
          </div>
          <div className="mt-1 font-mono text-lg">
            {invoice.invoiceNumber || "—"}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Issued {formatDate(invoice.issueDate)}
          </div>
          <div className="text-xs text-muted-foreground">
            Due {formatDate(invoice.dueDate)}
          </div>
          {servicePeriod ? (
            <div className="text-xs text-muted-foreground">
              Service {servicePeriod}
            </div>
          ) : null}
        </div>
      </header>

      <section className="mt-4">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Bill to
        </div>
        <div className="mt-1 font-medium">{client?.name ?? "—"}</div>
        {client?.email && model.showBuyerEmail ? (
          <div className="text-xs text-muted-foreground">{client.email}</div>
        ) : null}
        {client?.address ? (
          <div className="whitespace-pre-wrap text-xs text-muted-foreground">
            {client.address}
          </div>
        ) : null}
        {model.buyerTaxId ? (
          <div className="text-xs text-muted-foreground">
            {model.buyerTaxIdLabel}: {model.buyerTaxId}
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr
              className="border-b text-left"
              style={{ borderColor: accent, color: accent }}
            >
              <th className="py-2 pr-2 font-medium uppercase tracking-wider">
                Description
              </th>
              <th className="py-2 pr-2 text-right font-medium uppercase tracking-wider">
                Qty
              </th>
              <th className="py-2 pr-2 text-right font-medium uppercase tracking-wider">
                Rate
              </th>
              {model.hasTaxColumn ? (
                <th className="py-2 pr-2 text-right font-medium uppercase tracking-wider">
                  {model.taxLabel}
                </th>
              ) : null}
              <th className="py-2 text-right font-medium uppercase tracking-wider">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="py-8 text-center text-muted-foreground"
                >
                  No line items.
                </td>
              </tr>
            ) : (
              invoice.lineItems.map((item) => (
                <tr key={item.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-2">{item.description || "—"}</td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums">
                    {item.quantity}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums">
                    {formatCurrency(item.rate, model.currency)}
                  </td>
                  {model.hasTaxColumn ? (
                    <td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                      {item.taxRate ? `${item.taxRate}%` : "—"}
                    </td>
                  ) : null}
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(item.amount, model.currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-4 flex flex-col items-end gap-1">
        <div className="flex w-60 justify-between text-xs">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(model.subtotal, model.currency)}
          </span>
        </div>
        {model.taxGroups.map((group) => (
          <div key={group.rate} className="flex w-60 justify-between text-xs">
            <span className="text-muted-foreground">{group.label}</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(group.tax, model.currency)}
            </span>
          </div>
        ))}
        <div
          className="flex w-60 justify-between border-t pt-2 text-sm font-semibold"
          style={{ borderColor: accent }}
        >
          <span>Total due</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(model.total, model.currency)}
          </span>
        </div>
        {model.amountInWordsText ? (
          <div className="w-60 text-right text-xs italic text-muted-foreground">
            {model.amountInWordsText}
          </div>
        ) : null}
      </section>

      {invoice.notes ? (
        <section className="mt-6 border-t pt-4">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Notes
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs">{invoice.notes}</p>
        </section>
      ) : null}

      {model.hasPaymentBlock ? (
        <section className="mt-4 border-t pt-4">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Payment
          </div>
          <div className="mt-1 space-y-0.5 text-xs">
            {model.paymentMethod ? <p>{model.paymentMethod}</p> : null}
            {model.paymentUrl ? (
              <p className="text-muted-foreground">{model.paymentUrl}</p>
            ) : null}
            {model.bankAccount ? (
              <p>
                {model.bankAccountLabel}:{" "}
                <span className="font-mono">{model.bankAccount}</span>
              </p>
            ) : null}
            {model.swiftBic ? (
              <p>
                SWIFT/BIC: <span className="font-mono">{model.swiftBic}</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {settings.business.paymentInstructions ? (
        <section className="mt-4 border-t pt-4">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Payment instructions
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs">
            {settings.business.paymentInstructions}
          </p>
        </section>
      ) : null}

      {settings.invoice.footerText ? (
        <footer
          className="mt-6 border-t pt-4 text-center text-xs"
          style={{ color: accent }}
        >
          {settings.invoice.footerText}
        </footer>
      ) : null}
    </div>
  );
}
