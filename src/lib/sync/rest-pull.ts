/**
 * PULL direction of the cloud-mode reconciliation: plaintext REST tables
 * (the Neon tables behind `/api/v1/*`, used by the API/CLI) -> local Dexie
 * -> the end-to-end-encrypted sync vault.
 *
 * Cloud mode keeps two stores that diverge: the plaintext tables, which the
 * browser sync engine never reads, and the encrypted vault
 * (`/api/v1/sync/pull`/`push`, `{iv, ciphertext}` rows), which is the ONLY
 * thing the browser reads. This module closes the PULL half of the gap: it
 * lists every REST collection and computes which rows must be adopted into
 * Dexie so the push phase can then mirror them into the vault.
 *
 * The sibling push-mirror worker owns the opposite direction (Dexie/vault ->
 * REST, including deletions): this file only plans *adoptions* into Dexie.
 *
 * Bulk POST paths (used by the push phase to write back to REST, not by
 * this module): `/api/v1/tasks/bulk`, `/api/v1/expenses/bulk`,
 * `/api/v1/mileage/bulk`, `/api/v1/contracts/bulk`,
 * `/api/v1/tax-payments/bulk`, `/api/v1/rate-cards/bulk`.
 *
 * The caller (not this module) decides retry policy on fetch failures, and
 * performs the Dexie writes: `adopt`/`updateLocal` rows are written
 * verbatim, `apiDeleted` ids are deleted WITH a vault tombstone (the push
 * phase uploads the tombstone so it propagates).
 */
import type { SyncEntityType } from "@/lib/db/sync-store";

/** Entity types reconciled against REST. `setting` is excluded: it is a
 * document-style singleton handled by the engine, not a REST collection. */
export type RestEntityType = Exclude<SyncEntityType, "setting">;

/** One plaintext REST row. `updatedAt` is epoch millis; everything else is
 * opaque to the planner. */
export interface RestRow {
  id: string;
  updatedAt: number;
  [k: string]: unknown;
}

/** Entity type -> REST collection path. Order is deterministic so pull
 * results are reproducible. */
export const REST_PATHS: Record<RestEntityType, string> = {
  client: "/api/v1/clients",
  project: "/api/v1/projects",
  task: "/api/v1/tasks",
  expense: "/api/v1/expenses",
  invoice: "/api/v1/invoices",
  recurringSchedule: "/api/v1/recurring-schedules",
  retainer: "/api/v1/retainers",
  mileageEntry: "/api/v1/mileage",
  contract: "/api/v1/contracts",
  taxPayment: "/api/v1/tax-payments",
  rateCard: "/api/v1/rate-cards",
};

/** Compound key used to cross-reference the vault (which this module never
 * decrypts). The type is sliced off at the first colon, so entity ids that
 * contain colons remain safe. */
export const restKey = (t: string, id: string): string => `${t}:${id}`;

/**
 * Session-authed entity reads must also carry the sync CSRF header: the
 * routes accept the session cookie, and the header keeps the rule uniform
 * (writes require it; reads send it harmlessly).
 */
const SYNC_CSRF_HEADERS: HeadersInit = { "x-tallyhand-sync": "1" };

function splitRestKey(key: string): { type: string; id: string } {
  const idx = key.indexOf(":");
  return idx < 0
    ? { type: key, id: "" }
    : { type: key.slice(0, idx), id: key.slice(idx + 1) };
}

/** Fetch every REST collection in parallel (Clerk session cookie auth).
 * Throws on the first non-ok response with the HTTP status in the message;
 * the caller decides retry policy. */
export async function fetchRestTables(): Promise<
  Record<RestEntityType, RestRow[]>
> {
  const types = Object.keys(REST_PATHS) as RestEntityType[];
  const entries = await Promise.all(
    types.map(async (type): Promise<[RestEntityType, RestRow[]]> => {
      const path = REST_PATHS[type];
      const rows: RestRow[] = [];
      let cursor: string | null = null;
      // Entity endpoints default to 50 rows per response. Follow their
      // opaque cursor so the reconcile sees the full collection.
      do {
        const params = new URLSearchParams({ limit: "200" });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`${path}?${params.toString()}`, {
          credentials: "same-origin",
          headers: SYNC_CSRF_HEADERS,
        });
        if (!res.ok) {
          throw new Error(`REST pull failed for ${path} (${res.status})`);
        }
        const body = (await res.json()) as {
          data: unknown;
          meta?: { nextCursor?: string | null };
        };
        if (Array.isArray(body.data)) rows.push(...(body.data as RestRow[]));
        cursor = body.meta?.nextCursor ?? null;
      } while (cursor);
      return [type, rows];
    }),
  );
  return Object.fromEntries(entries) as Record<RestEntityType, RestRow[]>;
}

/** What the caller must do to Dexie after a REST pull. */
export interface RestAdoptionPlan {
  /** Rows unknown locally: write them into Dexie (new locally). */
  adopt: Array<{ type: RestEntityType; row: RestRow }>;
  /** REST is newer than Dexie: overwrite the Dexie row with the REST row. */
  updateLocal: Array<{ type: RestEntityType; row: RestRow }>;
  /** Deleted in the API while the vault still knew them: delete from Dexie
   * WITH a tombstone (the push phase uploads it so the deletion propagates). */
  apiDeleted: Array<{ type: RestEntityType; id: string }>;
}

/**
 * Last-write-wins by `updatedAt`, never resurrect.
 *
 * Rules:
 * 1. A REST row unknown locally and NOT vault-tombstoned is adopted — even
 *    if the vault knows it with an older `updatedAt` (the vault copy is
 *    stale; adopting the REST row is the update path).
 * 2. A REST row strictly newer than the local row (`>`, not `>=`) that is
 *    not vault-tombstoned overwrites it. Equal or older means converged and
 *    is ignored.
 * 3. A `vaultTombstoned` id is NEVER adopted or updated, however fresh the
 *    REST row is: deletion already won that race. The push-mirror worker
 *    deletes the row from REST to converge.
 * 4. API-side deletion: the vault knows the id (non-tombstoned `vaultRows`)
 *    but it is absent from the REST table, AND the local copy either does
 *    not exist or is unchanged since the last sync (`local <= vault`). If
 *    the local row is strictly newer than the vault snapshot, the local
 *    edit wins and the id is NOT deleted (push-mirror will re-create it in
 *    REST).
 */
export function planRestAdoption(args: {
  /** Dexie id -> updatedAt per entity type. */
  localByType: Record<RestEntityType, Map<string, number>>;
  restByType: Record<RestEntityType, RestRow[]>;
  /** restKey(type,id) -> updatedAt for non-deleted vault rows. */
  vaultRows: Map<string, number>;
  /** restKey(type,id) tombstoned in the vault (deletion won). */
  vaultTombstoned: Set<string>;
}): RestAdoptionPlan {
  const { localByType, restByType, vaultRows, vaultTombstoned } = args;
  const plan: RestAdoptionPlan = { adopt: [], updateLocal: [], apiDeleted: [] };

  const types = Object.keys(REST_PATHS) as RestEntityType[];
  for (const type of types) {
    const local = localByType[type];
    const rows = restByType[type] ?? [];

    // REST row ids present this pull (dedup keeps the freshest row per id).
    const freshest = new Map<string, RestRow>();
    for (const row of rows) {
      const prev = freshest.get(row.id);
      if (!prev || row.updatedAt > prev.updatedAt) freshest.set(row.id, row);
    }
    const restIds = new Set(freshest.keys());

    for (const [id, row] of freshest) {
      const key = restKey(type, id);
      // Rule 3: deletion won — never resurrect, however fresh the REST row.
      if (vaultTombstoned.has(key)) continue;
      const localTs = local.get(id);
      if (localTs === undefined) {
        // Rule 1: unknown locally -> adopt (vault may know a stale copy).
        plan.adopt.push({ type, row });
      } else if (row.updatedAt > localTs) {
        // Rule 2: strictly newer wins.
        plan.updateLocal.push({ type, row });
      }
    }

    // Rule 4: API-side deletions. Iterate the vault snapshot for this type;
    // the vault is the witness that the id *existed* and was not deleted.
    for (const [key, vaultTs] of vaultRows) {
      const { type: keyType, id } = splitRestKey(key);
      if (keyType !== type) continue;
      if (vaultTombstoned.has(key)) continue; // already deleted everywhere
      if (restIds.has(id)) continue; // still in REST — not deleted
      const localTs = local.get(id);
      if (localTs === undefined || localTs <= vaultTs) {
        // Absent locally, or local unchanged since the last sync snapshot:
        // the deletion in the API is the latest write.
        plan.apiDeleted.push({ type, id });
      }
      // Otherwise the local row is newer than the vault snapshot (local
      // edit after the last sync): the local edit wins, do NOT delete —
      // push-mirror re-creates it in REST.
    }
  }

  return plan;
}
