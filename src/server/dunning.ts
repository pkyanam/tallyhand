/**
 * SERVER ONLY — never import from client components.
 *
 * Dunning engine: computes reminder + late-fee actions for overdue
 * invoices, persists reminder logs and fee applications, and emits the
 * `onInvoiceOverdue` plugin hook for newly-overdue invoices.
 *
 * Pure computation lives in @/core/dunning (computeDunningActions,
 * applyLateFeeToInvoice); this module wires it to storage and plugins.
 */

import {
  applyLateFeeToInvoice,
  computeDunningActions,
  type DunningReminder,
  type LateFeeApplication,
} from "@/core/dunning";
import type { Invoice, Settings } from "@/core/entities";
import type { StorageProvider } from "@/core/storage";
import { pluginRegistry } from "@/plugins";

export interface DunningRunOptions {
  /** Preview only: compute actions without persisting or emitting hooks. */
  dryRun?: boolean;
  /** Override "now" (ms epoch), mainly for tests. */
  now?: number;
  /** Restrict the run to these invoice ids. */
  invoiceIds?: string[];
}

export interface DunningRunReport {
  dryRun: boolean;
  now: number;
  enabled: boolean;
  invoicesChecked: number;
  overdueCount: number;
  reminders: DunningReminder[];
  lateFees: LateFeeApplication[];
  newlyOverdue: Array<Pick<Invoice, "id" | "invoiceNumber" | "clientId">>;
}

export async function runDunning(
  provider: StorageProvider,
  settings: Settings,
  opts: DunningRunOptions = {},
): Promise<DunningRunReport> {
  const now = opts.now ?? Date.now();
  const config = settings.dunning;
  const report: DunningRunReport = {
    dryRun: opts.dryRun ?? false,
    now,
    enabled: config.enabled,
    invoicesChecked: 0,
    overdueCount: 0,
    reminders: [],
    lateFees: [],
    newlyOverdue: [],
  };
  if (!config.enabled) return report;

  let invoices = (await provider.listInvoices()).filter(
    (i) => i.status === "sent",
  );
  if (opts.invoiceIds && opts.invoiceIds.length > 0) {
    const ids = new Set(opts.invoiceIds);
    invoices = invoices.filter((i) => ids.has(i.id));
  }
  report.invoicesChecked = invoices.length;

  const clients = await provider.listClients(true);
  const clientsById = new Map(
    clients.map((c) => [c.id, { id: c.id, name: c.name }]),
  );

  const actions = computeDunningActions(invoices, clientsById, config, now);
  report.reminders = actions.reminders;
  report.lateFees = actions.lateFees;
  report.newlyOverdue = actions.newlyOverdue.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    clientId: i.clientId,
  }));
  report.overdueCount = new Set([
    ...actions.reminders.map((r) => r.invoiceId),
    ...actions.lateFees.map((f) => f.invoiceId),
    ...actions.newlyOverdue.map((i) => i.id),
  ]).size;

  if (report.dryRun) return report;

  // Persist reminder logs.
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));
  for (const reminder of actions.reminders) {
    const invoice = byInvoice.get(reminder.invoiceId);
    if (!invoice) continue;
    const log = [...(invoice.reminderLog ?? []), {
      reminderDay: reminder.reminderDay,
      sentAt: now,
    }];
    await provider.updateInvoice(reminder.invoiceId, { reminderLog: log });
    byInvoice.set(reminder.invoiceId, { ...invoice, reminderLog: log });
  }

  // Persist late fees (re-read after reminder writes so logs aren't lost).
  for (const fee of actions.lateFees) {
    const current =
      byInvoice.get(fee.invoiceId) ??
      (await provider.getInvoice(fee.invoiceId));
    if (!current) continue;
    const updated = applyLateFeeToInvoice(current, fee, now);
    await provider.updateInvoice(fee.invoiceId, {
      lineItems: updated.lineItems,
      subtotal: updated.subtotal,
      total: updated.total,
      lateFeeApplications: updated.lateFeeApplications,
    });
  }

  // Emit the overdue hook for newly-overdue invoices, then persist a
  // marker so repeated runs don't re-emit before the first reminder.
  // (Failures are logged by the registry; one bad handler must not break
  // the run.)
  for (const invoice of actions.newlyOverdue) {
    const fresh = (await provider.getInvoice(invoice.id)) ?? invoice;
    await pluginRegistry.emit("onInvoiceOverdue", fresh);
    await provider.updateInvoice(invoice.id, { overdueNotifiedAt: now });
  }

  return report;
}
