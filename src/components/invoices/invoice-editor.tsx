"use client";

import * as React from "react";
import { Clock, PenLine, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InvoicePreview } from "./invoice-preview";
import {
  computeLineItemAmount,
  defaultTaxIdLabelForRegion,
  invoiceTaxTotals,
  invoiceTotals,
  makeManualLineItem,
  resolveInvoiceCurrency,
  resolveInvoiceTaxRegion,
  resolveSellerTaxIdLabel,
} from "@/lib/invoice-helpers";
import { CURRENCIES } from "@/core/currencies";
import type {
  Client,
  Invoice,
  InvoiceLineItem,
  InvoiceTemplate,
  Settings,
  TaxRegion,
} from "@/lib/db/types";
import { cn, formatCurrency } from "@/lib/utils";

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function msFromYmd(ymd: string): number | null {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const ms = new Date(y, m - 1, d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Minimal two-or-more-option segmented control (black-and-white). */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex w-fit rounded-md border border-input p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[4px] px-3 py-1.5 text-sm transition-colors",
            option.value === value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface InvoiceEditorProps {
  invoice: Invoice;
  onChange: (next: Invoice) => void;
  settings: Settings;
  clients: Client[];
  actions?: React.ReactNode;
  statusBanner?: React.ReactNode;
  readOnly?: boolean;
}

export function InvoiceEditor({
  invoice,
  onChange,
  settings,
  clients,
  actions,
  statusBanner,
  readOnly,
}: InvoiceEditorProps) {
  const client = clients.find((c) => c.id === invoice.clientId);

  const setField = <K extends keyof Invoice>(key: K, value: Invoice[K]) =>
    onChange({ ...invoice, [key]: value });

  const region = resolveInvoiceTaxRegion(
    invoice,
    settings.invoice.defaultTaxRegion,
  );
  const currency = resolveInvoiceCurrency(
    invoice,
    settings.invoice.defaultCurrency,
  );
  const taxIdLabel = resolveSellerTaxIdLabel(
    invoice,
    settings.invoice.taxIdLabel,
  );

  const setTaxRegion = (next: TaxRegion) => {
    // Keep region and currency consistent: a region switch only moves the
    // currency when it is still the other region's default — an explicit
    // currency choice is left untouched.
    const nextCurrency =
      next === "EU" && currency === "USD"
        ? "EUR"
        : next === "US" && currency === "EUR"
          ? "USD"
          : invoice.currency;
    onChange({ ...invoice, taxRegion: next, currency: nextCurrency });
  };

  const updateLine = (index: number, patch: Partial<InvoiceLineItem>) => {
    const current = invoice.lineItems[index];
    if (!current) return;
    const merged: InvoiceLineItem = { ...current, ...patch };
    if (
      patch.quantity != null ||
      patch.rate != null ||
      "markupPercent" in patch
    ) {
      merged.amount = computeLineItemAmount(merged);
    }
    const next = [...invoice.lineItems];
    next[index] = merged;
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

  const addLine = () => {
    const next = [
      ...invoice.lineItems,
      makeManualLineItem(settings.invoice.defaultTaxRate),
    ];
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

  const removeLine = (index: number) => {
    const next = invoice.lineItems.filter((_, i) => i !== index);
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

  const taxTotals = invoiceTaxTotals(invoice.lineItems);
  const taxGroupLabel = (rate: number, label: string | null): string =>
    label ?? (region === "EU" ? `VAT (${rate}%)` : `Tax (${rate}%)`);

  const servicePeriodInvalid =
    invoice.serviceStart != null &&
    invoice.serviceEnd != null &&
    invoice.serviceStart > invoice.serviceEnd;

  const qrEnabled = invoice.qrEnabled ?? false;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        {statusBanner}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}

        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-client">Client</Label>
            <Select
              value={invoice.clientId || undefined}
              onValueChange={(v) => setField("clientId", v)}
              disabled={readOnly}
            >
              <SelectTrigger id="invoice-client">
                <SelectValue placeholder="Pick a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {invoice.createdAt === 0 ? <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={invoice.cloudLinkEnabled !== false} onCheckedChange={value => setField("cloudLinkEnabled", value === true)} disabled={readOnly} />
            <span>Enable cloud invoice link when stored online. Anyone with the link can view the saved invoice and download its PDF.</span>
          </label> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-number">Invoice #</Label>
              <Input
                id="invoice-number"
                defaultValue={invoice.invoiceNumber}
                key={`num-${invoice.id}-${invoice.invoiceNumber}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== invoice.invoiceNumber)
                    setField("invoiceNumber", v);
                }}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="issue-date">Issue date</Label>
              <Input
                id="issue-date"
                type="date"
                value={ymdFromMs(invoice.issueDate)}
                onChange={(e) => {
                  const ms = msFromYmd(e.target.value);
                  if (ms != null) setField("issueDate", ms);
                }}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="due-date">Due date</Label>
              <Input
                id="due-date"
                type="date"
                value={ymdFromMs(invoice.dueDate)}
                onChange={(e) => {
                  const ms = msFromYmd(e.target.value);
                  if (ms != null) setField("dueDate", ms);
                }}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="service-start">Service start</Label>
              <Input
                id="service-start"
                type="date"
                value={
                  invoice.serviceStart != null
                    ? ymdFromMs(invoice.serviceStart)
                    : ""
                }
                onChange={(e) => {
                  const ms = e.target.value
                    ? msFromYmd(e.target.value)
                    : null;
                  setField("serviceStart", ms ?? undefined);
                }}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="service-end">Service end</Label>
              <Input
                id="service-end"
                type="date"
                value={
                  invoice.serviceEnd != null ? ymdFromMs(invoice.serviceEnd) : ""
                }
                onChange={(e) => {
                  const ms = e.target.value
                    ? msFromYmd(e.target.value)
                    : null;
                  setField("serviceEnd", ms ?? undefined);
                }}
                disabled={readOnly}
              />
            </div>
            <div className="hidden items-end pb-2 sm:flex">
              <span className="text-xs text-muted-foreground">
                Optional service period.
              </span>
            </div>
          </div>
          {servicePeriodInvalid ? (
            <p className="text-xs text-muted-foreground">
              Service start is after the service end.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium">Localization</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-currency">Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => setField("currency", v)}
                disabled={readOnly}
              >
                <SelectTrigger id="invoice-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Tax region</Label>
              <SegmentedControl<TaxRegion>
                ariaLabel="Tax region"
                options={[
                  { value: "US", label: "US" },
                  { value: "EU", label: "EU" },
                ]}
                value={region}
                onChange={setTaxRegion}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-type">Document type</Label>
              <Input
                id="invoice-type"
                defaultValue={invoice.invoiceType ?? ""}
                key={`type-${invoice.id}-${invoice.invoiceType ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.invoiceType ?? "";
                  if (v !== current) setField("invoiceType", v || undefined);
                }}
                placeholder="Invoice"
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-template">PDF template</Label>
              <Select
                value={invoice.template ?? "default"}
                onValueChange={(v) =>
                  setField("template", v as InvoiceTemplate)
                }
                disabled={readOnly}
              >
                <SelectTrigger id="invoice-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Switching to EU moves an untouched USD currency to EUR, and
            switching back to US moves EUR to USD.
          </p>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-medium">Line items</h3>
            {!readOnly ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addLine}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add line
              </Button>
            ) : null}
          </div>
          {invoice.lineItems.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No line items yet. Add a manual line, or pick tracked time from
              the Ledger.
            </div>
          ) : (
            <ul className="divide-y">
              {invoice.lineItems.map((item, idx) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  onChange={(patch) => updateLine(idx, patch)}
                  onRemove={() => removeLine(idx)}
                  disabled={readOnly}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-col items-end gap-1 border-t px-4 py-3 text-sm">
            <div className="flex w-60 justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(invoice.subtotal, currency)}
              </span>
            </div>
            {taxTotals.groups.map((group) => (
              <div
                key={group.rate}
                className="flex w-60 justify-between"
              >
                <span className="text-muted-foreground">
                  {taxGroupLabel(group.rate, group.label)}
                </span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(group.tax, currency)}
                </span>
              </div>
            ))}
            <div className="flex w-60 justify-between text-base font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(invoice.total, currency)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t px-4 py-3">
            <Checkbox
              id="invoice-amount-in-words"
              checked={
                invoice.amountInWords ?? settings.invoice.amountInWordsDefault
              }
              onCheckedChange={(c) => setField("amountInWords", c === true)}
              disabled={readOnly}
            />
            <Label
              htmlFor="invoice-amount-in-words"
              className="text-sm font-normal"
            >
              Print amount in words
            </Label>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium">Payment</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-payment-method">Payment method</Label>
              <Input
                id="invoice-payment-method"
                defaultValue={invoice.paymentMethod ?? ""}
                key={`paymethod-${invoice.id}-${invoice.paymentMethod ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.paymentMethod ?? "";
                  if (v !== current)
                    setField("paymentMethod", v || undefined);
                }}
                placeholder="Bank transfer"
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-payment-url">Payment URL</Label>
              <Input
                id="invoice-payment-url"
                defaultValue={invoice.paymentUrl ?? ""}
                key={`payurl-${invoice.id}-${invoice.paymentUrl ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.paymentUrl ?? "";
                  if (v !== current) setField("paymentUrl", v || undefined);
                }}
                placeholder="https://…"
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-bank-account">
                {region === "EU" ? "IBAN" : "Bank account"}
              </Label>
              <Input
                id="invoice-bank-account"
                defaultValue={invoice.bankAccount ?? ""}
                key={`bank-${invoice.id}-${invoice.bankAccount ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.bankAccount ?? "";
                  if (v !== current) setField("bankAccount", v || undefined);
                }}
                placeholder={region === "EU" ? "DE89 …" : "Account details"}
                disabled={readOnly}
              />
            </div>
            {region === "EU" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="invoice-swift-bic">SWIFT / BIC</Label>
                <Input
                  id="invoice-swift-bic"
                  defaultValue={invoice.swiftBic ?? ""}
                  key={`bic-${invoice.id}-${invoice.swiftBic ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const current = invoice.swiftBic ?? "";
                    if (v !== current) setField("swiftBic", v || undefined);
                  }}
                  placeholder="DEUTDEFF"
                  disabled={readOnly}
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="invoice-qr-enabled"
              checked={qrEnabled}
              onCheckedChange={(c) => setField("qrEnabled", c === true)}
              disabled={readOnly}
            />
            <Label htmlFor="invoice-qr-enabled" className="text-sm font-normal">
              Show payment QR code
            </Label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-qr-description">QR description</Label>
            <Input
              id="invoice-qr-description"
              defaultValue={invoice.qrDescription ?? ""}
              key={`qrdesc-${invoice.id}-${invoice.qrDescription ?? ""}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                const current = invoice.qrDescription ?? "";
                if (v !== current) setField("qrDescription", v || undefined);
              }}
              placeholder="Scan to pay"
              disabled={readOnly || !qrEnabled}
            />
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium">Parties &amp; visibility</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-seller-tax-id">
                Seller {taxIdLabel.toLowerCase()}
              </Label>
              <Input
                id="invoice-seller-tax-id"
                defaultValue={invoice.sellerTaxId ?? ""}
                key={`sellertax-${invoice.id}-${invoice.sellerTaxId ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.sellerTaxId ?? "";
                  if (v !== current) setField("sellerTaxId", v || undefined);
                }}
                placeholder={taxIdLabel}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-seller-tax-id-label">
                {taxIdLabel} label
              </Label>
              <Input
                id="invoice-seller-tax-id-label"
                defaultValue={invoice.sellerTaxIdLabel ?? ""}
                key={`sellertaxlabel-${invoice.id}-${invoice.sellerTaxIdLabel ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.sellerTaxIdLabel ?? "";
                  if (v !== current)
                    setField("sellerTaxIdLabel", v || undefined);
                }}
                placeholder={defaultTaxIdLabelForRegion(invoice.taxRegion)}
                disabled={readOnly}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-buyer-tax-id">Buyer tax ID</Label>
              <Input
                id="invoice-buyer-tax-id"
                defaultValue={invoice.buyerTaxId ?? ""}
                key={`buyertax-${invoice.id}-${invoice.buyerTaxId ?? ""}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = invoice.buyerTaxId ?? "";
                  if (v !== current) setField("buyerTaxId", v || undefined);
                }}
                placeholder={region === "EU" ? "Buyer VAT ID" : "Buyer tax ID"}
                disabled={readOnly}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="invoice-seller-email-visible"
                checked={invoice.sellerEmailVisible ?? true}
                onCheckedChange={(c) =>
                  setField("sellerEmailVisible", c === true)
                }
                disabled={readOnly}
              />
              <Label
                htmlFor="invoice-seller-email-visible"
                className="text-sm font-normal"
              >
                Show seller email
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="invoice-buyer-email-visible"
                checked={invoice.buyerEmailVisible ?? true}
                onCheckedChange={(c) =>
                  setField("buyerEmailVisible", c === true)
                }
                disabled={readOnly}
              />
              <Label
                htmlFor="invoice-buyer-email-visible"
                className="text-sm font-normal"
              >
                Show buyer email
              </Label>
            </div>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="invoice-notes">Notes</Label>
          <Textarea
            id="invoice-notes"
            rows={3}
            placeholder="Thanks for the work this month."
            defaultValue={invoice.notes ?? ""}
            key={`notes-${invoice.id}`}
            onBlur={(e) => {
              const v = e.target.value;
              const current = invoice.notes ?? "";
              if (v !== current) setField("notes", v || undefined);
            }}
            disabled={readOnly}
          />
          <p className="text-xs text-muted-foreground">
            Payment instructions are pulled from Settings → Invoices (
            {settings.business.paymentInstructions ? "configured" : "not set"}
            ).
          </p>
        </div>
      </div>

      <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
        <InvoicePreview
          invoice={invoice}
          settings={settings}
          client={client}
        />
      </div>
    </div>
  );
}

function sourceIcon(type: InvoiceLineItem["sourceType"]) {
  if (type === "task") return <Clock className="h-3.5 w-3.5" />;
  if (type === "expense") return <Receipt className="h-3.5 w-3.5" />;
  return <PenLine className="h-3.5 w-3.5" />;
}

function LineItemRow({
  item,
  onChange,
  onRemove,
  disabled,
}: {
  item: InvoiceLineItem;
  onChange: (patch: Partial<InvoiceLineItem>) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const commitNumber = (
    raw: string,
    field: "quantity" | "rate",
    current: number,
  ) => {
    const n = Number.parseFloat(raw);
    const value = Number.isFinite(n) && n >= 0 ? n : current;
    if (value !== current) onChange({ [field]: value });
  };

  const commitTaxRate = (raw: string) => {
    const v = raw.trim();
    if (v === "") {
      if (item.taxRate != null) onChange({ taxRate: undefined });
      return;
    }
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return;
    if (n !== item.taxRate) onChange({ taxRate: n });
  };

  const isExpense = item.sourceType === "expense";

  return (
    <li
      className={cn(
        "grid items-start gap-2 px-4 py-3 text-sm sm:items-center",
        isExpense
          ? "sm:grid-cols-[1fr_52px_72px_56px_64px_88px_32px]"
          : "sm:grid-cols-[1fr_70px_90px_64px_100px_32px]",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-2 text-muted-foreground"
          title={item.sourceType ?? "manual"}
        >
          {sourceIcon(item.sourceType)}
        </div>
        <Input
          className="h-9"
          defaultValue={item.description}
          key={`desc-${item.id}`}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== item.description) onChange({ description: v });
          }}
          placeholder="Description"
          disabled={disabled}
        />
      </div>
      <Input
        className="h-9 text-right font-mono text-xs"
        inputMode="decimal"
        title="Quantity"
        defaultValue={String(item.quantity)}
        key={`qty-${item.id}-${item.quantity}`}
        onBlur={(e) =>
          commitNumber(e.target.value, "quantity", item.quantity)
        }
        disabled={disabled}
      />
      <Input
        className="h-9 text-right font-mono text-xs"
        inputMode="decimal"
        title={isExpense ? "Base (pre-markup)" : "Rate"}
        defaultValue={String(item.rate)}
        key={`rate-${item.id}-${item.rate}`}
        onBlur={(e) => commitNumber(e.target.value, "rate", item.rate)}
        disabled={disabled}
      />
      {isExpense ? (
        <Input
          className="h-9 text-right font-mono text-xs"
          inputMode="decimal"
          title="Markup %"
          placeholder="%"
          defaultValue={
            item.markupPercent == null ? "" : String(item.markupPercent)
          }
          key={`mk-${item.id}-${item.markupPercent ?? "x"}`}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              if (item.markupPercent != null) onChange({ markupPercent: undefined });
              return;
            }
            const n = Number.parseFloat(raw);
            if (!Number.isFinite(n) || n < 0) return;
            const next = n === 0 ? undefined : n;
            if (next !== item.markupPercent) onChange({ markupPercent: next });
          }}
          disabled={disabled}
        />
      ) : null}
      <Input
        className="h-9 text-right font-mono text-xs"
        inputMode="decimal"
        title="Tax %"
        placeholder="%"
        defaultValue={item.taxRate == null ? "" : String(item.taxRate)}
        key={`tax-${item.id}-${item.taxRate ?? "x"}`}
        onBlur={(e) => commitTaxRate(e.target.value)}
        disabled={disabled}
      />
      <div className="text-right font-mono text-xs tabular-nums">
        {formatCurrency(item.amount)}
      </div>
      {!disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Remove line"
          className="h-8 w-8"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <div />
      )}
    </li>
  );
}
