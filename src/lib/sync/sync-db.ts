/**
 * Sync metadata database — a tiny SEPARATE Dexie database (`tallyhand-sync`),
 * deliberately not part of the main `tallyhand` DB:
 *
 * - `keys`: the user's AES-GCM data key, exported as base64url, keyed by
 *   user id. The key NEVER leaves this device (no server upload, no
 *   inclusion in exports).
 * - `tombstones`: entities deleted locally while sync is enabled, so the
 *   next push can tell the cloud (and other devices) about the deletion.
 * - `meta`: per-user sync cursors (`lastSync:<userId>` → ms epoch) and the
 *   last-pushed settings JSON (`settingsPushed:<userId>`, for change
 *   detection since Settings carries no updatedAt).
 *
 * CLIENT ONLY — IndexedDB does not exist server-side. All functions throw
 * when called without a window.
 */
import Dexie, { type Table } from "dexie";

export interface SyncKeyRow {
  /** user id — one key per signed-in user on this device */
  name: string;
  /** base64url-exported AES-GCM-256 key (see src/lib/sync/crypto.ts) */
  keyB64: string;
  createdAt: number;
}

export interface SyncTombstone {
  /** Owning user — tombstones are per-user so an account switch on a shared
   *  device can never leak one user's deletions into another's vault. */
  userId: string;
  entityType: string;
  entityId: string;
  deletedAt: number;
}

export interface SyncMetaRow {
  name: string;
  value: string;
}

class SyncMetaDB extends Dexie {
  keys!: Table<SyncKeyRow, string>;
  tombstones!: Table<SyncTombstone, [string, string, string]>;
  meta!: Table<SyncMetaRow, string>;

  constructor() {
    super("tallyhand-sync");
    this.version(2).stores({
      keys: "name",
      // v2: tombstones are per-user (v1 had no userId; the upgrade drops any
      // draft-era tombstones, which is safe — a missed tombstone only means
      // one deletion doesn't propagate once).
      tombstones: "[userId+entityType+entityId], userId, deletedAt",
      meta: "name",
    });
  }
}

let _db: SyncMetaDB | null = null;

export function getSyncDb(): SyncMetaDB {
  if (typeof window === "undefined") {
    throw new Error("Sync metadata DB is client-only (IndexedDB).");
  }
  if (!_db) _db = new SyncMetaDB();
  return _db;
}

/** Test helper: drop the singleton so the next getSyncDb() reopens. */
export function resetSyncDbForTests(): void {
  _db = null;
}

// -- key storage -----------------------------------------------------------

export async function storeSyncKey(userId: string, keyB64: string): Promise<void> {
  await getSyncDb().keys.put({
    name: userId,
    keyB64,
    createdAt: Date.now(),
  });
}

export async function loadSyncKey(userId: string): Promise<string | undefined> {
  const row = await getSyncDb().keys.get(userId);
  return row?.keyB64;
}

export async function deleteSyncKey(userId: string): Promise<void> {
  await getSyncDb().keys.delete(userId);
}

// -- tombstones ------------------------------------------------------------

export async function recordTombstone(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await getSyncDb().tombstones.put({
    userId,
    entityType,
    entityId,
    deletedAt: Date.now(),
  });
}

export async function listTombstones(userId: string): Promise<SyncTombstone[]> {
  return getSyncDb().tombstones.where("userId").equals(userId).toArray();
}

export async function clearTombstone(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await getSyncDb().tombstones.delete([userId, entityType, entityId]);
}

// -- meta ------------------------------------------------------------------

async function getMeta(name: string): Promise<string | undefined> {
  return (await getSyncDb().meta.get(name))?.value;
}

async function setMeta(name: string, value: string): Promise<void> {
  await getSyncDb().meta.put({ name, value });
}

export const getLastSyncAt = (userId: string): Promise<string | undefined> =>
  getMeta(`lastSync:${userId}`);

export const setLastSyncAt = (userId: string, at: number): Promise<void> =>
  setMeta(`lastSync:${userId}`, String(at));

export const getLastPushedSettings = (userId: string): Promise<string | undefined> =>
  getMeta(`settingsPushed:${userId}`);

export const setLastPushedSettings = (
  userId: string,
  json: string,
): Promise<void> => setMeta(`settingsPushed:${userId}`, json);

export const getSettingsPushedAt = async (userId: string): Promise<number> =>
  Number((await getMeta(`settingsPushedAt:${userId}`)) ?? 0) || 0;

export const setSettingsPushedAt = (userId: string, at: number): Promise<void> =>
  setMeta(`settingsPushedAt:${userId}`, String(at));
