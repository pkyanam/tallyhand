"use client";

import * as React from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import {
  listReceiptOcrProviders,
  type ReceiptOcrResult,
} from "@/core/receipt-ocr";

export function ReceiptOcrButton({
  imageDataUrl,
  providerId,
  onApply,
}: {
  imageDataUrl: string;
  /** Pre-selected provider id (defaults to the first registered). */
  providerId?: string;
  /** Called with the extraction result; the parent decides what to fill. */
  onApply: (result: ReceiptOcrResult) => void;
}) {
  const { showNotice } = useAppChrome();
  const [scanning, setScanning] = React.useState(false);
  const [result, setResult] = React.useState<ReceiptOcrResult | null>(null);

  const scan = async () => {
    const providers = listReceiptOcrProviders();
    if (providers.length === 0) {
      showNotice(
        "No receipt OCR provider is installed. Fill in the fields manually — or add a provider plugin (see the receipt OCR interface in src/core/receipt-ocr.ts).",
      );
      return;
    }
    const provider =
      providers.find((p) => p.id === providerId) ?? providers[0];
    setScanning(true);
    try {
      const r = await provider.extract(imageDataUrl);
      setResult(r);
      onApply(r);
    } catch (e) {
      showNotice(
        e instanceof Error ? e.message : "Receipt scan failed.",
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void scan()}
        disabled={scanning}
      >
        <ScanLine className="mr-1 h-4 w-4" />
        {scanning ? "Scanning…" : "Scan receipt"}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">
          Found
          {result.amount != null ? ` $${result.amount.toFixed(2)}` : ""}
          {result.date ? ` on ${result.date}` : ""}
          {result.merchant ? ` from ${result.merchant}` : ""}
          {` (${Math.round(result.confidence * 100)}% confidence)`}
          {result.category ? ` — suggested: ${result.category}` : ""}. Blanks
          were filled in; check them before saving.
        </p>
      )}
    </div>
  );
}
