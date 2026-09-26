/**
 * Receipt OCR provider interface (pure — no UI/storage/network imports).
 *
 * Tallyhand ships no built-in OCR engine: extracting text from a receipt
 * image needs either a WASM engine (e.g. tesseract.js — a new dependency)
 * or a cloud vision API (needs a key). Plugins register providers here;
 * the expense form calls them and always offers manual entry as fallback.
 */

export interface ReceiptOcrResult {
  /** Total amount on the receipt. */
  amount?: number;
  /** ISO date yyyy-mm-dd. */
  date?: string;
  /** Merchant / vendor name. */
  merchant?: string;
  /** Suggested expense category. */
  category?: string;
  /** 0..1 overall confidence. */
  confidence: number;
  /** Raw extracted text, when the engine exposes it. */
  rawText?: string;
}

export interface ReceiptOcrProvider {
  /** Stable id, e.g. "tesseract" or "cloud-vision". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Extract fields from a data-URL image (as stored in receiptB64). */
  extract(imageDataUrl: string): Promise<ReceiptOcrResult>;
}

const providers = new Map<string, ReceiptOcrProvider>();

/**
 * Register an OCR provider. Returns an unregister function so plugins
 * (or tests) can clean up.
 */
export function registerReceiptOcrProvider(
  provider: ReceiptOcrProvider,
): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
    }
  };
}

/** Providers currently registered, in registration order. */
export function listReceiptOcrProviders(): ReceiptOcrProvider[] {
  return Array.from(providers.values());
}

/** Clear all providers (tests / hot-reload). */
export function clearReceiptOcrProviders(): void {
  providers.clear();
}

/**
 * Merge an OCR result into existing form values: OCR fills blanks, never
 * overwrites what the user already typed.
 */
export function applyOcrResult<T extends { amount?: string; date?: string }>(
  current: T,
  result: ReceiptOcrResult,
): T {
  const next = { ...current };
  if (
    (next.amount == null || next.amount.trim() === "") &&
    result.amount != null &&
    Number.isFinite(result.amount)
  ) {
    next.amount = String(result.amount);
  }
  if ((next.date == null || next.date.trim() === "") && result.date) {
    next.date = result.date;
  }
  return next;
}
