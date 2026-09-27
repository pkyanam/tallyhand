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

export function PublicInvoiceClient({
  token,
  cloudMode = false,
}: {
  token: string;
  cloudMode?: boolean;
}) {
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
                {cloudMode
                  ? "This older browser-bound link cannot find the invoice here. Open the invoice in your account and create a cloud link from its Share panel."
                  : "This link only works in the browser that created it. If you opened it elsewhere or cleared site data, use that browser or restore a backup."}
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
        <Card className="mb-4 border-border bg-secondary">
          <CardContent className="p-3 text-xs text-muted-foreground">
            {cloudMode
              ? "This older link opens invoice data saved in this browser. For a link that works on any device, create a cloud link from the invoice’s Share panel."
              : "This link reads invoice data saved in this browser. It is not a hosted document; use a backup to move the invoice to another browser."}
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
