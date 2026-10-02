"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import type { Client, Invoice, Settings } from "@/lib/db/types";
import { resolveInvoiceQrPayload } from "@/core/invoice";

export function PdfDownloadButton({
  invoice,
  settings,
  client,
  disabled,
  cloud = false,
}: {
  invoice: Invoice;
  settings: Settings;
  client?: Client;
  disabled?: boolean;
  cloud?: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const { showNotice } = useAppChrome();

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (cloud) {
        const response = await fetch(`/api/v1/invoices/${encodeURIComponent(invoice.id)}/pdf`);
        if (!response.ok) throw new Error(`PDF export failed (${response.status})`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `${invoice.invoiceNumber || "invoice"}.pdf`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      // Generate the payment QR code (when enabled) before rendering, so
      // InvoicePdf stays synchronous. Failures render a QR-less PDF rather
      // than breaking the download.
      let qrDataUrl: string | undefined;
      const qrPayload = resolveInvoiceQrPayload(invoice, {
        businessName: settings.business.name || "",
      });
      if (qrPayload) {
        try {
          const { toDataURL } = await import("qrcode");
          qrDataUrl = await toDataURL(qrPayload, {
            width: 192,
            margin: 1,
            errorCorrectionLevel: "M",
          });
        } catch (qrErr) {
          console.warn("QR generation failed; exporting without QR.", qrErr);
        }
      }
      const [{ pdf }, { InvoicePdf }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf-template"),
      ]);
      const blob = await pdf(
        <InvoicePdf
          invoice={invoice}
          settings={settings}
          client={client}
          qrDataUrl={qrDataUrl}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoiceNumber || "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
