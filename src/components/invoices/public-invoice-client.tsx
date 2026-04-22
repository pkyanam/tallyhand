"use client";

import * as React from "react";
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { clientRepo, invoiceRepo, settingsRepo } from "@/lib/db/repos";
import type { Client, Invoice, Settings } from "@/lib/db/types";

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "ready"; invoice: Invoice; settings: Settings; clients: Client[] };

export function PublicInvoiceClient({ token }: { token: string }) {
  const decoded = React.useMemo(() => {
    try {
      return decodeURIComponent(token);
    } catch {
      return token;
    }
  }, [token]);

  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ status: "loading" });
      try {
        const [invoice, settings, clients] = await Promise.all([
          invoiceRepo.getByPublicToken(decoded),
          settingsRepo.get(),
          clientRepo.list(true),
        ]);
        if (cancelled) return;
        if (!invoice) {
          setState({ status: "not_found" });
          return;
        }
        setState({
          status: "ready",
          invoice,
          settings,
          clients,
        });
      } catch {
        if (!cancelled) setState({ status: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <FileQuestion className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Invoice not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This link only works in the browser profile that created the
                invoice. If you opened this on another device or after clearing
                site data, import a backup from Settings → Data first.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/">Back to Tallyhand</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, settings, clients } = state;
  const client = clients.find((c) => c.id === invoice.clientId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <span className="font-semibold">Tallyhand</span>
            <span className="text-muted-foreground"> · read-only invoice</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 text-xs text-muted-foreground">
            Local-only: this page reads from IndexedDB in your browser. It is not
            a hosted document and cannot be verified by a third party without
            your data file.
          </CardContent>
        </Card>
        <InvoicePreview
          invoice={invoice}
          settings={settings}
          client={client}
        />
      </main>
    </div>
  );
}
