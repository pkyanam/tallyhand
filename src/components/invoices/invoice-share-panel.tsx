"use client";

import * as React from "react";
import { notifyDataChanged } from "@/lib/data/data-events";
import {
  Share2,
  Link2,
  Copy,
  ExternalLink,
  FileDown,
  TriangleAlert,
  Cloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Client, Invoice, Settings } from "@/lib/db/types";
import {
  buildShareableInvoiceHtml,
  shareInvoiceFileName,
} from "@/lib/invoice-share-file";

function publicInvoiceUrl(token: string): string {
  if (typeof window === "undefined") return "";
  const path = `/invoice/public/${encodeURIComponent(token)}`;
  return `${window.location.origin}${path}`;
}

const LOCAL_LINK_COPY = {
  badge: "This browser only",
  badgeClass: "border-border bg-secondary text-secondary-foreground",
  message: (
    <>
      This invoice is stored only in this browser. Its link cannot share it
      with someone using another browser or device, even when Tallyhand is
      hosted online. Download the shareable file below, or sign in and create
      a cloud link.
    </>
  ),
};

export function InvoiceSharePanel({
  invoice,
  savedInvoice,
  client,
  settings,
  readOnly,
  dirty,
  cloudSharingEnabled,
}: {
  /** The on-screen invoice (may hold unsaved edits). */
  invoice: Invoice;
  /** The last saved version, if the invoice has been saved at least once. */
  savedInvoice?: Invoice | null;
  client?: Client | null;
  settings?: Settings | null;
  readOnly: boolean;
  dirty: boolean;
  /** True when this page request belongs to a signed-in account. */
  cloudSharingEnabled: boolean;
}) {
  const currentInvoiceId = React.useRef(invoice.id);
  currentInvoiceId.current = invoice.id;
  const [copied, setCopied] = React.useState(false);
  // Cloud share state (signed-in only): a hosted /share/[token] link backed
  // by a server-stored snapshot, so it opens in any browser.
  const [cloudUrl, setCloudUrl] = React.useState<string | null>(null);
  const [cloudDisabled, setCloudDisabled] = React.useState(false);
  const [cloudBusy, setCloudBusy] = React.useState(false);
  const [cloudError, setCloudError] = React.useState<string | null>(null);
  const copy_ = LOCAL_LINK_COPY;
  const token = invoice.publicToken;

  // The file must reflect saved data. When the draft is dirty we export the
  // last saved version (and say so); a never-saved invoice has no file yet.
  const exportSource = dirty ? (savedInvoice ?? null) : invoice;

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const setCloudSharing = React.useCallback(async (enabled: boolean) => {
    if (!invoice.id) return;
    setCloudBusy(true); setCloudError(null);
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoice.id)}/share`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-tallyhand-sync": "1" },
        body: JSON.stringify({ enabled }),
      });
      const result = await res.json();
      if (currentInvoiceId.current !== invoice.id) return;
      if (!res.ok) throw new Error(result.error?.message ?? "Could not update cloud sharing.");
      setCloudDisabled(!enabled);
      notifyDataChanged();
      setCloudUrl(result.data.shareUrl ? new URL(result.data.shareUrl, window.location.origin).toString() : null);
    } catch (error) { if (currentInvoiceId.current === invoice.id) setCloudError(error instanceof Error ? error.message : "Could not update cloud sharing."); }
    finally { if (currentInvoiceId.current === invoice.id) setCloudBusy(false); }
  }, [invoice.id]);

  React.useEffect(() => {
    if (!cloudSharingEnabled || !invoice.id) return;
    let cancelled = false;
    setCloudUrl(null); setCloudBusy(true); setCloudError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoice.id)}`);
        const result = await res.json();
        if (!res.ok) throw new Error("Save this invoice to your cloud workspace before sharing.");
        if (cancelled) return;
        const disabled = result.data.cloudLinkEnabled === false;
        setCloudDisabled(disabled);
        if (result.data.shareUrl) setCloudUrl(new URL(result.data.shareUrl, window.location.origin).toString());
        else if (!disabled) await setCloudSharing(true);
      } catch (error) { if (!cancelled) setCloudError(error instanceof Error ? error.message : "Could not load cloud sharing."); }
      finally { if (!cancelled) setCloudBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [cloudSharingEnabled, invoice.id, invoice.cloudLinkEnabled, setCloudSharing]);

  const downloadFile = () => {
    if (!exportSource) return;
    const html = buildShareableInvoiceHtml({
      invoice: exportSource,
      client: client ?? null,
      settings: settings ?? null,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareInvoiceFileName(exportSource);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Card className="mb-4 border-dashed">
      <CardContent className="space-y-4 p-4 text-sm">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-muted-foreground" />
          <p className="font-medium">Share</p>
        </div>

        {/* ——— Cloud link (signed in): works in any browser ——— */}
        {cloudSharingEnabled ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
                Cloud link
              </span>
              <Badge variant="outline" className="badge-positive">
                Anyone with the link
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Cloud invoices have a link by default. Anyone with the link can view the saved invoice and download its PDF. Disable it to make the invoice private.
              {dirty
                ? " Unsaved edits are not visible until saved."
                : ""}
            </p>
            {!cloudDisabled ? <Button type="button" variant="ghost" size="sm" disabled={cloudBusy} onClick={() => void setCloudSharing(false)}>Disable cloud link</Button> : <p className="text-muted-foreground">Cloud link disabled. Previous links no longer work.</p>}
            {!cloudUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cloudBusy || !exportSource?.id}
                  onClick={() => void setCloudSharing(true)}
                >
                  {cloudBusy ? "Loading…" : cloudDisabled ? "Enable cloud link" : "Retry cloud link"}
                </Button>
                {cloudError ? (
                  <p className="text-xs text-destructive">{cloudError}</p>
                ) : null}
                {!exportSource?.id ? (
                  <p className="text-xs text-muted-foreground">
                    Save the invoice first.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded border bg-muted/50 px-2 py-1 font-mono text-xs tabular-nums">
                  {cloudUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => void copyLink(cloudUrl)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  asChild
                >
                  <a href={cloudUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {cloudSharingEnabled ? <Separator /> : null}

        {/* Local-mode link: backed only by this browser's IndexedDB. */}
        {!cloudSharingEnabled ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                Link
              </span>
              <Badge variant="outline" className={copy_.badgeClass}>
                {copy_.badge}
              </Badge>
            </div>
            <p className="text-muted-foreground">{copy_.message}</p>
            {!token ? (
              <p className="text-muted-foreground">
                {dirty
                  ? "Save your changes to generate a link."
                  : "Save once to generate a shareable link."}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded border bg-muted/50 px-2 py-1 font-mono text-xs tabular-nums">
                  {publicInvoiceUrl(token)}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => void copyLink(publicInvoiceUrl(token))}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  asChild
                >
                  <a
                    href={publicInvoiceUrl(token)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </Button>
              </div>
            )}
            {readOnly && token ? (
              <p className="text-xs text-muted-foreground">
                This invoice is paid — the link still works for viewing.
              </p>
            ) : null}
          </div>
        ) : null}

        {!cloudSharingEnabled ? <Separator /> : null}

        {/* ——— File path: works anywhere, always ——— */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 font-medium">
            <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
            File — works anywhere
          </p>
          <p className="text-muted-foreground">
            Downloads a single self-contained HTML file with this invoice —
            no Tallyhand needed to open it. Email it or send it in a message;
            it opens in any browser and prints cleanly.
          </p>
          {dirty && savedInvoice ? (
            <p className="flex items-start gap-1.5 text-xs text-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              You have unsaved changes — the file will contain the last saved
              version.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={downloadFile}
              disabled={!exportSource}
            >
              <FileDown className="h-3.5 w-3.5" />
              Download shareable file
            </Button>
            {exportSource ? (
              <code className="max-w-full truncate rounded border bg-muted/50 px-2 py-1 font-mono text-xs">
                {shareInvoiceFileName(exportSource)}
              </code>
            ) : (
              <p className="text-xs text-muted-foreground">
                Save the invoice first to export a file.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
