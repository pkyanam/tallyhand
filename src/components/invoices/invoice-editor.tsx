"use client";

import * as React from "react";
import { Clock, PenLine, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  computeLineAmount,
  invoiceTotals,
  makeManualLineItem,
} from "@/lib/invoice-helpers";
import type {
  Client,
  Invoice,
  InvoiceLineItem,
  Settings,
} from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";

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

  const updateLine = (index: number, patch: Partial<InvoiceLineItem>) => {
    const current = invoice.lineItems[index];
    if (!current) return;
    const merged: InvoiceLineItem = { ...current, ...patch };
    if (patch.quantity != null || patch.rate != null) {
      merged.amount = computeLineAmount(merged.quantity, merged.rate);
    }
    const next = [...invoice.lineItems];
    next[index] = merged;
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

  const addLine = () => {
    const next = [...invoice.lineItems, makeManualLineItem()];
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

  const removeLine = (index: number) => {
    const next = invoice.lineItems.filter((_, i) => i !== index);
    const { subtotal, total } = invoiceTotals(next);
    onChange({ ...invoice, lineItems: next, subtotal, total });
  };

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
                {formatCurrency(invoice.subtotal)}
              </span>
            </div>
            <div className="flex w-60 justify-between text-base font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(invoice.total)}
              </span>
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

  return (
    <li className="grid items-start gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_70px_90px_100px_32px] sm:items-center">
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
        defaultValue={String(item.rate)}
        key={`rate-${item.id}-${item.rate}`}
        onBlur={(e) => commitNumber(e.target.value, "rate", item.rate)}
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
