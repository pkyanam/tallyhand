"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import type { Client, Invoice, Settings } from "@/lib/db/types";

export function PdfDownloadButton({
  invoice,
  settings,
  client,
  disabled,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
  disabled?: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const { showNotice } = useAppChrome();

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const [{ pdf }, { InvoicePdf }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf-template"),
      ]);
      const blob = await pdf(
        <InvoicePdf invoice={invoice} settings={settings} client={client} />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoiceNumber || "invoice"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showNotice("PDF export failed. Check the console.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={disabled || pending}
    >
      <Download className="mr-1 h-4 w-4" />
      {pending ? "Preparing…" : "Download PDF"}
    </Button>
  );
}
