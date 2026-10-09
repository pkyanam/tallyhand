import type { Invoice } from "../entities";
import { legacyTotalToMoney } from "./money";
import type { InvoiceSnapshot } from "./types";

/** Canonical, collision-free serialization. This is an equality fingerprint,
 * not a signature; it deliberately works in browsers and Convex without crypto. */
export function invoiceFingerprint(invoice: unknown): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, ordered(v)]),
      );
    }
    return value;
  }
  return JSON.stringify(ordered(invoice));
}

export function snapshotInvoice(invoice: Invoice): InvoiceSnapshot {
  if (invoice.status !== "sent")
    throw new Error("Only sent invoices can be collected online");
  const money = legacyTotalToMoney(invoice.total, invoice.currency ?? "USD");
  if (!money.minorUnits) throw new Error("Invoice has no balance to collect");
  return {
    invoiceId: invoice.id,
    revision: String(invoice.updatedAt),
    fingerprint: invoiceFingerprint(invoice),
    money,
  };
}
