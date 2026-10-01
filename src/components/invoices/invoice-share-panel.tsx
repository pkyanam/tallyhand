"use client";

import * as React from "react";
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
  const [copied, setCopied] = React.useState(false);
  // Cloud share state (signed-in only): a hosted /share/[token] link backed
  // by a server-stored snapshot, so it opens in any browser.
  const [cloudUrl, setCloudUrl] = React.useState<string | null>(null);
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

  const createCloudLink = async () => {
    const source = exportSource;
    if (!source?.id) return;
    setCloudBusy(true);
    setCloudError(null);
    try {
      const res = await fetch("/api/share/links", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "invoice",
          target: {
            invoiceId: source.id,
            snapshot: {
              invoice: source,
              client: client ?? null,
            },
          },
          expiresInDays: 30,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Couldn't create the share link.");
      }
      // The API deliberately supports relative URLs when APP_BASE_URL is not
      // configured. Always present/copy an absolute hosted URL in the UI.
      setCloudUrl(new URL(data.url, window.location.origin).toString());
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : "Couldn't create the share link.");
    } finally {
      setCloudBusy(false);
    }
  };

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
              Hosted by Tallyhand — opens in any browser, on any device.
              {dirty
                ? " The link captures the last saved version."
                : ""}
            </p>
            {!cloudUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cloudBusy || !exportSource?.id}
                  onClick={() => void createCloudLink()}
                >
                  {cloudBusy ? "Creating…" : "Create cloud link"}
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
