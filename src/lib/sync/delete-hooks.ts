/**
 * CLIENT ONLY — records sync tombstones when the user deletes entities.
 *
 * Dexie `deleting` hooks on every entity table: when sync is enabled, a
 * single-entity delete writes a tombstone into the sync metadata DB so the
 * next push tells the cloud (and other devices) about the deletion.
 *
 * Installed once per page load by `<SyncBootstrap/>` (rendered in the app
 * layout) whenever sync is enabled. No-ops entirely when sync is off, so
 * local-first flows are untouched. Suppressed while the sync engine itself
 * applies remote tombstones (`isTombstoneSuppressed()`), and during bundle
 * import/reset — those wholesale replaces reconcile via
 * `reconcileAfterLocalReplace()` instead (id-diff, not hook-diff, because
 * `Table.clear()` hook semantics aren't something to bet the vault on).
 */
import { getDB } from "@/lib/db/schema";
import { recordTombstone } from "./sync-db";
import { isSyncEnabled, isTombstoneSuppressed, syncUserId } from "./engine";

const ENTITY_TABLES: { table: string; entityType: string }[] = [
  { table: "clients", entityType: "client" },
  { table: "projects", entityType: "project" },
  { table: "tasks", entityType: "task" },
  { table: "expenses", entityType: "expense" },
  { table: "invoices", entityType: "invoice" },
  { table: "recurringSchedules", entityType: "recurringSchedule" },
  { table: "retainers", entityType: "retainer" },
  { table: "mileageEntries", entityType: "mileageEntry" },
  { table: "contracts", entityType: "contract" },
  { table: "taxPayments", entityType: "taxPayment" },
  { table: "rateCards", entityType: "rateCard" },
];

let installed = false;

/**
 * Idempotent. Safe to call on every page load; the hooks no-op unless sync
 * is currently enabled for a user.
 */
export function installDeleteHooks(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const db = getDB();
  for (const { table, entityType } of ENTITY_TABLES) {
    db.table(table).hook("deleting", (primKey) => {
      // Fire-and-forget: the hook must never block or break a delete.
      const uid = syncUserId();
      if (!isTombstoneSuppressed() && isSyncEnabled() && uid) {
        void recordTombstone(uid, entityType, String(primKey)).catch(() => {});
      }
    });
  }
}
