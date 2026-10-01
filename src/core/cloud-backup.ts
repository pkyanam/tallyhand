import { parseAndValidateBundle } from "../lib/v1-import";
import type { TallyhandBundleV1 } from "./backup";

export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 2000;
export const BACKUP_TABLES = ["clients", "projects", "tasks", "expenses", "invoices", "recurringSchedules", "retainers", "mileageEntries", "contracts", "taxPayments", "rateCards"] as const;

/** Shared by browser, API and database boundary; all validation precedes writes. */
export function validateCloudBackup(raw: unknown): TallyhandBundleV1 {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BACKUP_BYTES)
    throw new Error("Backup exceeds the 4 MiB atomic import limit. Nothing was changed.");
  const { bundle } = parseAndValidateBundle(raw);
  let count = 0;
  const ids: Record<string, Set<string>> = {};
  for (const table of BACKUP_TABLES) {
    const rows = bundle[table] ?? [];
    count += rows.length;
    ids[table] = new Set();
    for (const row of rows) {
      if (ids[table].has(row.id)) throw new Error(`Duplicate ID in ${table}: ${row.id}`);
      ids[table].add(row.id);
      if (new TextEncoder().encode(JSON.stringify(row)).length > 800 * 1024)
        throw new Error(`A ${table} record is too large for cloud storage.`);
    }
  }
  if (count > MAX_BACKUP_RECORDS) throw new Error("Backup exceeds the 2,000-record atomic import limit. Nothing was changed.");
  const ref = (table: string, id: string | undefined, context: string) => {
    if (id && !ids[table].has(id)) throw new Error(`${context} refers to a missing ${table} record (${id}).`);
  };
  for (const row of bundle.projects) ref("clients", row.clientId, "Project");
  for (const row of bundle.tasks) { ref("projects", row.projectId, "Time entry"); ref("invoices", row.invoiceId, "Time entry"); }
  for (const row of bundle.expenses) { ref("clients", row.clientId, "Expense"); ref("projects", row.projectId, "Expense"); ref("invoices", row.invoiceId, "Expense"); }
  for (const row of bundle.invoices) {
    ref("clients", row.clientId, "Invoice");
    for (const line of row.lineItems) {
      if (line.sourceType === "task") ref("tasks", line.sourceId, "Invoice line");
      if (line.sourceType === "expense") ref("expenses", line.sourceId, "Invoice line");
    }
  }
  for (const row of bundle.recurringSchedules ?? []) { ref("clients", row.clientId, "Recurring schedule"); ref("projects", row.projectId, "Recurring schedule"); }
  for (const row of bundle.retainers ?? []) { ref("clients", row.clientId, "Retainer"); ref("recurringSchedules", row.recurringScheduleId, "Retainer"); }
  for (const row of bundle.contracts ?? []) ref("clients", row.clientId, "Contract");
  for (const row of bundle.rateCards ?? []) ref("clients", row.clientId, "Rate card");
  for (const row of bundle.mileageEntries ?? []) { ref("clients", row.clientId, "Mileage"); ref("projects", row.projectId, "Mileage"); ref("invoices", row.invoiceId, "Mileage"); }
  return bundle;
}
