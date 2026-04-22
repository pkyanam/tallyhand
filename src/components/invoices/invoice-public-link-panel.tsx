"use client";

import * as React from "react";
import { Link2, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Invoice } from "@/lib/db/types";

function publicInvoiceUrl(token: string): string {
  if (typeof window === "undefined") return "";
  const path = `/invoice/public/${encodeURIComponent(token)}`;
  return `${window.location.origin}${path}`;
}

export function InvoicePublicLinkPanel({
  invoice,
  readOnly,
  dirty,
}: {
  invoice: Invoice;
  readOnly: boolean;
  dirty: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const token = invoice.publicToken;

  const copy = async () => {
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

  return (
    <Card className="mb-4 border-dashed">
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-start gap-2">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">Public view link</p>
            <p className="text-muted-foreground">
              Opens a read-only copy of this invoice in the browser. Data lives
              in this browser only — there is no server copy on Vercel or
              elsewhere, so anyone opening the link must already have your
              export in this profile, or you are sharing the same device.
            </p>
          </div>
        </div>
        {!token ? (
          <p className="text-muted-foreground">
            {dirty
              ? "Save your changes to generate a link."
              : "Save once to generate a shareable link."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded border bg-muted/50 px-2 py-1 text-xs">
              {publicInvoiceUrl(token)}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => void copy()}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="gap-1" asChild>
              <a href={publicInvoiceUrl(token)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          </div>
        )}
        {readOnly && token ? (
          <p className="text-xs text-muted-foreground">
            This invoice is paid — the link still works for viewing in your
            browser.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
