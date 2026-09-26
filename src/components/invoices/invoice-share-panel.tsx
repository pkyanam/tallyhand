"use client";

import * as React from "react";
import {
  Share2,
  Link2,
  Copy,
  ExternalLink,
  FileDown,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Client, Invoice, Settings } from "@/lib/db/types";
import {
  classifyHostReachability,
  type ShareReachability,
} from "@/lib/share-reachability";
import {
  buildShareableInvoiceHtml,
  shareInvoiceFileName,
} from "@/lib/invoice-share-file";

function publicInvoiceUrl(token: string): string {
  if (typeof window === "undefined") return "";
  const path = `/invoice/public/${encodeURIComponent(token)}`;
  return `${window.location.origin}${path}`;
}

const REACHABILITY_COPY: Record<
  ShareReachability,
  { badge: string; badgeClass: string; message: React.ReactNode }
> = {
  device: {
    badge: "This device only",
    badgeClass: "border-border bg-secondary text-secondary-foreground",
    message: (
      <>
        You&rsquo;re running Tallyhand on this device only. If you send this
        link to someone else it will <strong>not</strong> work — their browser
        can&rsquo;t reach your computer. Use the file option below to share
        with anyone.
      </>
    ),
  },
  lan: {
    badge: "Local network",
    badgeClass: "border-border text-foreground",
    message: (
      <>
        Devices on your local network — like your phone on the same Wi-Fi —
        can open this link. It won&rsquo;t work over the internet; use the
        file option below for that.
      </>
    ),
  },
  internet: {
    badge: "Anyone with the link",
    badgeClass: "badge-positive",
    message: (
      <>
        This Tallyhand is reachable from the internet, so anyone you send the
        link to can open it.
      </>
    ),
  },
};

export function InvoiceSharePanel({
  invoice,
  savedInvoice,
  client,
  settings,
  readOnly,
  dirty,
}: {
  /** The on-screen invoice (may hold unsaved edits). */
  invoice: Invoice;
  /** The last saved version, if the invoice has been saved at least once. */
  savedInvoice?: Invoice | null;
  client?: Client | null;
  settings?: Settings | null;
  readOnly: boolean;
  dirty: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  // Set after mount so server and client render identically (no hydration
  // mismatch); the classifier's conservative default is "device".
  const [hostname, setHostname] = React.useState("");
  React.useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  const reachability = classifyHostReachability(hostname);
  const copy_ = REACHABILITY_COPY[reachability];
  const token = invoice.publicToken;

  // The file must reflect saved data. When the draft is dirty we export the
  // last saved version (and say so); a never-saved invoice has no file yet.
  const exportSource = dirty ? (savedInvoice ?? null) : invoice;

  const copyLink = async () => {
    if (!token) return;
    const url = publicInvoiceUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
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

        {/* ——— Link path: works when this Tallyhand is reachable ——— */}
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
                onClick={() => void copyLink()}
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

        <Separator />

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
