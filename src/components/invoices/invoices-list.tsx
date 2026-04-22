"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { clientRepo, invoiceRepo } from "@/lib/db/repos";
import type { Invoice, InvoiceStatus } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";

type SortKey = "issueDate" | "invoiceNumber";

function statusVariant(status: InvoiceStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        className:
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
      };
    case "sent":
      return {
        label: "Sent",
        className:
          "bg-primary/15 text-foreground border-primary/30",
      };
    default:
      return {
        label: "Draft",
        className:
          "bg-muted text-muted-foreground border-border",
      };
  }
}

export function InvoicesList() {
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);

  const [sort, setSort] = React.useState<SortKey>("issueDate");

  const clientById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients ?? []) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const sorted = React.useMemo(() => {
    if (!invoices) return undefined;
    const copy = [...invoices];
    if (sort === "invoiceNumber") {
      copy.sort((a, b) =>
        a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, {
          numeric: true,
        }),
      );
      copy.reverse();
    } else {
      copy.sort((a, b) => b.issueDate - a.issueDate);
    }
    return copy;
  }, [invoices, sort]);

  const handleDelete = async (invoice: Invoice) => {
    if (invoice.status !== "draft") return;
    const ok = window.confirm(
      `Delete draft ${invoice.invoiceNumber}? This cannot be undone.`,
    );
    if (!ok) return;
    await invoiceRepo.remove(invoice.id);
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Drafts and sent invoices. PDF export included."
        actions={
          <Button asChild>
            <Link href="/invoices/new">
              <Plus className="mr-1 h-4 w-4" />
              New invoice
            </Link>
          </Button>
        }
      />

      {invoices === undefined ? (
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading invoices…
          </CardContent>
        </Card>
      ) : sorted && sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No invoices yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select tracked time in the Ledger and click{" "}
                <span className="font-medium">Invoice selected</span>, or start
                a blank invoice below.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/invoices/new">
                <Plus className="mr-1 h-4 w-4" />
                New blank invoice
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-xs text-muted-foreground">
              <span>Sort by</span>
              <button
                type="button"
                className={
                  sort === "issueDate"
                    ? "font-medium text-foreground"
                    : "hover:underline"
                }
                onClick={() => setSort("issueDate")}
              >
                Issue date
              </button>
              <span>·</span>
              <button
                type="button"
                className={
                  sort === "invoiceNumber"
                    ? "font-medium text-foreground"
                    : "hover:underline"
                }
                onClick={() => setSort("invoiceNumber")}
              >
                Number
              </button>
            </div>
            <ul className="divide-y">
              {(sorted ?? []).map((inv) => {
                const s = statusVariant(inv.status);
                return (
                  <li
                    key={inv.id}
                    className="group flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                  >
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <div className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
                        {inv.invoiceNumber}
                      </div>
                      <div className="min-w-0 flex-1 truncate">
                        {clientById.get(inv.clientId) ?? "Unknown client"}
                      </div>
                      <div className="w-28 shrink-0 text-xs text-muted-foreground">
                        {new Date(inv.issueDate).toLocaleDateString()}
                      </div>
                      <div className="w-20 shrink-0">
                        <Badge variant="outline" className={s.className}>
                          {s.label}
                        </Badge>
                      </div>
                      <div className="w-28 shrink-0 text-right font-mono tabular-nums">
                        {formatCurrency(inv.total)}
                      </div>
                    </Link>
                    {inv.status === "draft" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => handleDelete(inv)}
                        aria-label={`Delete draft ${inv.invoiceNumber}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="w-9" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
