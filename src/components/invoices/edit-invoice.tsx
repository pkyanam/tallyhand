"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCheck,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { InvoiceEditor } from "./invoice-editor";
import { PdfDownloadButton } from "./pdf-download-button";
import {
  clientRepo,
  invoiceRepo,
  settingsRepo,
} from "@/lib/db/repos";
import {
  markInvoicePaid,
  markInvoiceSent,
} from "@/lib/invoice-helpers";
import type { Invoice, InvoiceStatus } from "@/lib/db/types";

function statusBadge(status: InvoiceStatus) {
  switch (status) {
    case "paid":
      return (
        <Badge
          variant="outline"
          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
        >
          Paid
        </Badge>
      );
    case "sent":
      return (
        <Badge
          variant="outline"
          className="bg-primary/15 text-foreground border-primary/30"
        >
          Sent
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          Draft
        </Badge>
      );
  }
}

function invoicesEqual(a: Invoice, b: Invoice): boolean {
  return (
    a.clientId === b.clientId &&
    a.invoiceNumber === b.invoiceNumber &&
    a.issueDate === b.issueDate &&
    a.dueDate === b.dueDate &&
    a.status === b.status &&
    a.subtotal === b.subtotal &&
    a.total === b.total &&
    (a.notes ?? "") === (b.notes ?? "") &&
    JSON.stringify(a.lineItems) === JSON.stringify(b.lineItems)
  );
}

export function EditInvoiceContent({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { showNotice } = useAppChrome();

  const invoice = useLiveQuery(
    () => invoiceRepo.get(invoiceId),
    [invoiceId],
  );
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const settings = useLiveQuery(() => settingsRepo.read(), []);

  React.useEffect(() => {
    void settingsRepo.get();
  }, []);

  const [draft, setDraft] = React.useState<Invoice | null>(null);
  const lastSyncedRef = React.useRef<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Sync draft from DB when invoice changes and local draft matches what was
  // last saved (no unsaved user edits sitting on top).
  React.useEffect(() => {
    if (!invoice) return;
    if (!draft || draft.id !== invoice.id) {
      setDraft(invoice);
      lastSyncedRef.current = JSON.stringify(invoice);
      return;
    }
    if (lastSyncedRef.current === JSON.stringify(draft)) {
      setDraft(invoice);
      lastSyncedRef.current = JSON.stringify(invoice);
    }
  }, [invoice, draft]);

  const dirty = React.useMemo(() => {
    if (!draft || !invoice) return false;
    return !invoicesEqual(draft, invoice);
  }, [draft, invoice]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.clientId) {
      showNotice("Pick a client before saving.");
      return;
    }
    setSaving(true);
    try {
      await invoiceRepo.update(draft.id, {
        clientId: draft.clientId,
        invoiceNumber: draft.invoiceNumber,
        issueDate: draft.issueDate,
        dueDate: draft.dueDate,
        lineItems: draft.lineItems,
        subtotal: draft.subtotal,
        total: draft.total,
        notes: draft.notes,
      });
      lastSyncedRef.current = JSON.stringify({
        ...draft,
        updatedAt: draft.updatedAt,
      });
      showNotice("Saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSent = async () => {
    if (!invoice) return;
    if (invoice.status !== "draft") return;
    if (dirty) {
      showNotice("Save your changes before marking sent.");
      return;
    }
    await markInvoiceSent(invoice);
    showNotice(`${invoice.invoiceNumber} marked as sent.`);
  };

  const handleMarkPaid = async () => {
    if (!invoice) return;
    if (invoice.status === "paid") return;
    await markInvoicePaid(invoice.id);
    showNotice(`${invoice.invoiceNumber} marked as paid.`);
  };

  const handleDelete = async () => {
    if (!invoice) return;
    const ok = window.confirm(
      `Delete ${invoice.invoiceNumber}? ${
        invoice.status !== "draft"
          ? "This invoice has been sent. Linked tasks/expenses keep their billed state."
          : "This cannot be undone."
      }`,
    );
    if (!ok) return;
    await invoiceRepo.remove(invoice.id);
    router.replace("/invoices");
  };

  if (invoice === undefined || !clients || !settings) {
    return (
      <>
        <PageHeader title="Invoice" />
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  if (invoice === null || !draft) {
    return (
      <>
        <PageHeader
          title="Invoice not found"
          actions={
            <Button asChild variant="outline">
              <Link href="/invoices">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
          }
        />
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            This invoice may have been deleted.
          </CardContent>
        </Card>
      </>
    );
  }

  const client = clients.find((c) => c.id === invoice.clientId);
  const readOnly = invoice.status === "paid";

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span>{invoice.invoiceNumber}</span>
            {statusBadge(invoice.status)}
          </span>
        }
        description={client ? `For ${client.name}` : undefined}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/invoices">
                <ArrowLeft className="mr-1 h-4 w-4" />
                All invoices
              </Link>
            </Button>
            <PdfDownloadButton
              invoice={draft}
              settings={settings}
              client={client}
              disabled={dirty}
            />
            {invoice.status === "draft" ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleMarkSent}
                disabled={dirty}
              >
                <Send className="mr-1 h-4 w-4" />
                Mark as sent
              </Button>
            ) : null}
            {invoice.status !== "paid" ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleMarkPaid}
              >
                {invoice.status === "sent" ? (
                  <CheckCheck className="mr-1 h-4 w-4" />
                ) : (
                  <BadgeCheck className="mr-1 h-4 w-4" />
                )}
                Mark as paid
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || readOnly}
            >
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </>
        }
      />

      {readOnly ? (
        <Card className="mb-4 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 text-sm">
            This invoice is marked paid — editing is locked to preserve the
            record. Delete and recreate if you need to change it.
          </CardContent>
        </Card>
      ) : null}

      <InvoiceEditor
        invoice={draft}
        onChange={setDraft}
        settings={settings}
        clients={clients}
        readOnly={readOnly}
      />
    </>
  );
}
