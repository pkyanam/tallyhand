// Pure invoice domain helpers live in core; re-exported here so existing
// `@/lib/invoice-helpers` imports keep working.
export * from "@/core/invoice";

import { getStorageProvider } from "./db/repos";
import { pluginRegistry } from "@/plugins/registry";
import type { Invoice } from "@/core/entities";

/**
 * Storage-backed operations, programmed against the active StorageProvider.
 * Hook emission for invoice lifecycle events happens here, next to the
 * operation (task/expense hooks live in the repos layer).
 */
export async function assignNextInvoiceNumber(): Promise<string> {
  return getStorageProvider().assignNextInvoiceNumber();
}

export async function markInvoiceSent(invoice: Invoice): Promise<void> {
  const provider = getStorageProvider();
  await provider.markInvoiceSent(invoice);
  const updated = await provider.getInvoice(invoice.id);
  await pluginRegistry.emit(
    "onInvoiceSent",
    updated ?? { ...invoice, status: "sent" as const },
  );
}

export async function markInvoicePaid(invoiceId: string): Promise<void> {
  const provider = getStorageProvider();
  await provider.markInvoicePaid(invoiceId);
  const updated = await provider.getInvoice(invoiceId);
  if (updated) {
    await pluginRegistry.emit("onInvoicePaid", updated);
  }
}
