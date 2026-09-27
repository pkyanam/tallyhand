/**
 * Encrypted-sync engine (CLIENT ONLY).
 *
 * Orchestrates one sync round against `/api/v1/sync/*`:
 *   pull (decrypt + last-write-wins merge into Dexie)
 *   → push (encrypt every local entity + tombstones, server re-applies LWW)
 *
 * Runs ONLY when the user is signed in AND has opted in (localStorage flag)
 * AND a data key exists in IndexedDB. Otherwise everything stays
 * local-first, exactly as today — this module is never invoked.
 *
 * Key management (generate/export/import) lives here too; the settings UI
 * (`@/components/settings/sync-card.tsx`) calls these functions.
 */
import { getDB } from "@/lib/db/schema";
import {
  clientRepo,
  projectRepo,
  taskRepo,
  expenseRepo,
  invoiceRepo,
  recurringScheduleRepo,
  retainerRepo,
  mileageRepo,
  contractRepo,
  taxPaymentRepo,
  rateCardRepo,
  settingsRepo,
} from "@/lib/db/repos";
import {
  SYNC_ENTITY_TYPES,
  SYNC_ENTITY_TABLES,
  type EncryptedEntityPush,
  type SyncEntityType,
} from "@/lib/db/sync-store";
import {
  generateDataKey,
  exportDataKey,
  importDataKey,
  keyFingerprint,
  encryptJson,
  decryptJson,
} from "./crypto";
import {
  storeSyncKey,
  loadSyncKey,
  deleteSyncKey,
  listTombstones,
  clearTombstone,
  recordTombstone,
  getLastSyncAt,
  setLastSyncAt,
  getLastPushedSettings,
  setLastPushedSettings,
  getSettingsPushedAt,
  setSettingsPushedAt,
  getVaultState,
  setVaultState,
  getSyncDb,
} from "./sync-db";
import { planPullMerge, type RemoteSnapshot } from "./merge";
import {
  fetchRestTables,
  planRestAdoption,
  restKey,
  type RestEntityType,
} from "./rest-pull";
import {
  planRestMirror,
  applyRestMirror,
  loadMirroredState,
  saveMirroredState,
  type MirrorEntity,
} from "./rest-mirror";

export const SYNC_ENABLED_KEY = "tallyhand.sync.enabled";
export const SYNC_USER_KEY = "tallyhand.sync.user";
export const SETTINGS_ENTITY_ID = "settings";

/** Entity type → Dexie table name (settings handled separately). */
const ENTITY_TABLES = SYNC_ENTITY_TABLES;

const REPOS: Record<Exclude<SyncEntityType, "setting">, { list: () => Promise<{ id: string; updatedAt: number }[]> }> = {
  client: clientRepo,
  project: projectRepo,
  task: taskRepo,
  expense: expenseRepo,
  invoice: invoiceRepo,
  recurringSchedule: recurringScheduleRepo,
  retainer: retainerRepo,
  mileageEntry: mileageRepo,
  contract: contractRepo,
  taxPayment: taxPaymentRepo,
  rateCard: rateCardRepo,
};

/** Set while the engine applies remote rows: the delete hooks must not tombstone them. */
let suppressTombstones = false;
export function isTombstoneSuppressed(): boolean {
  return suppressTombstones;
}

export function isSyncEnabled(): boolean {
  try {
    return window.localStorage.getItem(SYNC_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSyncEnabled(enabled: boolean, userId?: string): void {
  try {
    if (enabled) {
      window.localStorage.setItem(SYNC_ENABLED_KEY, "1");
      if (userId) window.localStorage.setItem(SYNC_USER_KEY, userId);
    } else {
      window.localStorage.removeItem(SYNC_ENABLED_KEY);
      window.localStorage.removeItem(SYNC_USER_KEY);
    }
  } catch {
    /* storage unavailable — sync stays off */
  }
}

export function syncUserId(): string | null {
  try {
    return window.localStorage.getItem(SYNC_USER_KEY);
  } catch {
    return null;
  }
}

// -- key management ----------------------------------------------------------

export async function ensureDataKey(userId: string): Promise<CryptoKey> {
  const existing = await loadSyncKey(userId);
  if (existing) return importDataKey(existing);
  const key = await generateDataKey();
  await storeSyncKey(userId, await exportDataKey(key));
  return key;
}

export async function getDataKey(userId: string): Promise<CryptoKey | null> {
  const existing = await loadSyncKey(userId);
  return existing ? importDataKey(existing) : null;
}

export async function rotateDataKey(userId: string): Promise<CryptoKey> {
  const key = await generateDataKey();
  await storeSyncKey(userId, await exportDataKey(key));
  // The new key can't read previously pushed snapshots — that is the point
  // of rotation, and the reason the UI warns loudly before doing it.
  return key;
}

export async function forgetDataKey(userId: string): Promise<void> {
  await deleteSyncKey(userId);
}

export { exportDataKey, importDataKey, keyFingerprint };

// -- server API --------------------------------------------------------------

interface SyncStatus {
  signedIn: boolean;
  storage: string;
  syncSupported: boolean;
  userId?: string;
  cloudCount?: number;
  vaultError?: boolean;
}

async function fetchStatus(): Promise<SyncStatus> {
  const res = await fetch("/api/v1/sync/status", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Sync status failed (${res.status})`);
  const body = (await res.json()) as { data: SyncStatus };
  return body.data;
}

export type { SyncStatus };
export { fetchStatus as getSyncStatus };

interface PullRow {
  entityType: SyncEntityType;
  entityId: string;
  iv: string;
  ciphertext: string;
  updatedAt: number;
  deleted: boolean;
}

async function fetchPull(
  since: number,
  afterId?: string,
): Promise<{ rows: PullRow[]; truncated: boolean; serverTime: number }> {
  const params = new URLSearchParams({ since: String(since) });
  if (afterId) params.set("afterId", afterId);
  const res = await fetch(`/api/v1/sync/pull?${params.toString()}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Sync pull failed (${res.status})`);
  const body = (await res.json()) as {
    data: { entities: PullRow[]; truncated?: boolean; serverTime: number };
  };
  return {
    rows: body.data.entities,
    truncated: body.data.truncated === true,
    serverTime: body.data.serverTime,
  };
}

/**
 * Pull every changed row, following `truncated` pages with the keyset
 * cursor. Returns the full ordered row list; the caller decrypts and
 * derives the resume cursor from it.
 */
async function fetchAllPullRows(
  since: number,
): Promise<{ rows: PullRow[]; truncated: boolean }> {
  const all: PullRow[] = [];
  let pageSince = since;
  let afterId: string | undefined;
  let truncated = false;
  // Safety bound: 200 pages x 5000 rows is far beyond any realistic vault;
  // without it a server bug could spin this loop forever. If the bound is
  // ever hit with pages still remaining, `truncated` stays true and the
  // caller keeps the old cursor (retry next round) rather than skipping.
  for (let page = 0; page < 200; page++) {
    const { rows, truncated: more } = await fetchPull(pageSince, afterId);
    all.push(...rows);
    truncated = more;
    if (!more || rows.length === 0) break;
    const last = rows[rows.length - 1];
    pageSince = last.updatedAt;
    afterId = last.entityId;
  }
  return { rows: all, truncated };
}

async function postPush(items: EncryptedEntityPush[]): Promise<number> {
  const res = await fetch("/api/v1/sync/push", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-tallyhand-sync": "1",
    },
    body: JSON.stringify({ entities: items }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sync push failed (${res.status}) ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data: { written: number } };
  return body.data.written;
}

// -- sync round --------------------------------------------------------------

export interface SyncResult {
  status: "ok" | "disabled" | "unavailable" | "no-key" | "error";
  /** Human-readable reason when status != "ok". */
  reason?: string;
  pulled?: number;
  applied?: number;
  pushed?: number;
  decryptErrors?: number;
  /** Rows adopted/updated from the plaintext REST tables this round. */
  restAdopted?: number;
  /** Non-fatal REST reconcile failure (vault sync still succeeded). */
  restError?: string;
  /** REST mirror outcomes (browser -> plaintext tables). */
  mirrored?: { created: number; updated: number; removed: number };
}

let running: Promise<SyncResult> | null = null;

/** Run one full sync round (pull → merge → push). Concurrent calls share the in-flight round. */
export function runSync(): Promise<SyncResult> {
  if (!running) {
    running = doSync().finally(() => {
      running = null;
    });
  }
  return running;
}

async function doSync(): Promise<SyncResult> {
  let status: SyncStatus;
  try {
    status = await fetchStatus();
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message : "status failed" };
  }
  if (!status.signedIn || !status.syncSupported) {
    return {
      status: "unavailable",
      reason: !status.signedIn
        ? "Not signed in."
        : `This server's storage (${status.storage}) doesn't support encrypted sync — needs postgres or neon.`,
    };
  }
  if (!isSyncEnabled()) return { status: "disabled", reason: "Sync is off." };
  const userId = status.userId ?? syncUserId();
  if (!userId) return { status: "error", reason: "No user id for sync." };

  let key: CryptoKey | null;
  try {
    key = await getDataKey(userId);
  } catch {
    key = null;
  }
  if (!key) {
    return {
      status: "no-key",
      reason: "No sync key on this device — generate one or import it from another device.",
    };
  }

  const since = Number((await getLastSyncAt(userId)) ?? 0) || 0;
  const result: SyncResult = {
    status: "ok",
    pulled: 0,
    applied: 0,
    pushed: 0,
    decryptErrors: 0,
  };

  // -- pull -----------------------------------------------------------------
  let newCursor = since;
  // Ids adopted from the plaintext REST tables this round — the push-phase
  // REST mirror skips them so adoption never writes straight back.
  const adoptedIds: Set<string> = new Set();
  try {
    const { rows, truncated } = await fetchAllPullRows(since);
    result.pulled = rows.length;

    // Decrypt (tombstones carry no payload — skip decryption for them).
    const snapshots: RemoteSnapshot[] = [];
    let decryptFailed = false;
    let batchMax = since;
    for (const row of rows) {
      if (!SYNC_ENTITY_TYPES.includes(row.entityType)) continue;
      let entity: unknown;
      if (!row.deleted) {
        try {
          entity = await decryptJson(key, { iv: row.iv, ciphertext: row.ciphertext });
        } catch {
          result.decryptErrors = (result.decryptErrors ?? 0) + 1;
          decryptFailed = true;
          continue;
        }
      }
      snapshots.push({
        entityType: row.entityType,
        entityId: row.entityId,
        updatedAt: row.updatedAt,
        deleted: row.deleted,
        entity,
      });
      if (row.updatedAt > batchMax) batchMax = row.updatedAt;
    }
    // Cursor rule (retryability first): a decrypt failure — or pagination
    // that never terminated — keeps the old cursor so the unseen/failed
    // rows are re-fetched next round. Re-applying the good rows is harmless:
    // the LWW merge treats equal timestamps as converged.
    newCursor = decryptFailed || truncated ? since : batchMax;

    // Merge per entity type (settings handled separately below).
    const db = getDB();
    suppressTombstones = true;
    try {
      for (const type of SYNC_ENTITY_TYPES) {
        if (type === "setting") continue;
        const table = ENTITY_TABLES[type];
        const local = (await REPOS[type].list()) as { id: string; updatedAt: number }[];
        const localById = new Map(local.map((e) => [e.id, e.updatedAt]));
        const { apply } = planPullMerge(
          localById,
          snapshots.filter((s) => s.entityType === type),
        );
        for (const snap of apply) {
          const t = db.table(table);
          if (snap.deleted) {
            await t.delete(snap.entityId);
            await clearTombstone(userId, type, snap.entityId);
          } else {
            await t.put(snap.entity as Record<string, unknown>);
          }
          result.applied = (result.applied ?? 0) + 1;
        }
      }
      await applyRemoteSettings(key, snapshots, userId, result);
    } finally {
      suppressTombstones = false;
    }

    // -- vault-state bookkeeping --------------------------------------------
    // The pull endpoint only returns rows changed since the cursor, so the
    // full set of vault-known ids is maintained incrementally here (and in
    // the push phase). The REST reconcile below needs it to tell
    // "deleted via the REST API" apart from "new local row not yet pushed".
    {
      const vs = await getVaultState(userId);
      for (const row of rows) {
        if (!SYNC_ENTITY_TYPES.includes(row.entityType)) continue;
        const k = restKey(row.entityType, row.entityId);
        if (row.deleted) {
          vs.tombstoned[k] = row.updatedAt;
          delete vs.ids[k];
        } else {
          vs.ids[k] = Math.max(vs.ids[k] ?? 0, row.updatedAt);
          delete vs.tombstoned[k];
        }
      }
      await setVaultState(userId, vs);
    }

    // -- REST plaintext reconcile -------------------------------------------
    // The REST API/CLI reads and writes plaintext tables that the encrypted
    // vault never sees. Fold them in: adopt new/changed server rows into
    // Dexie (the push phase encrypts them into the vault), and turn
    // server-side deletions into local tombstones. Best-effort — a REST
    // failure must not fail the vault sync that already succeeded.
    try {
      const restByType = await fetchRestTables();
      const vs = await getVaultState(userId);
      const localByType = {} as Record<RestEntityType, Map<string, number>>;
      for (const type of SYNC_ENTITY_TYPES) {
        if (type === "setting") continue;
        const t = type as RestEntityType;
        const local = await REPOS[t].list();
        localByType[t] = new Map(local.map((e) => [e.id, e.updatedAt]));
      }
      const plan = planRestAdoption({
        localByType,
        restByType,
        vaultRows: new Map(Object.entries(vs.ids)),
        vaultTombstoned: new Set(Object.keys(vs.tombstoned)),
      });
      suppressTombstones = true;
      try {
        for (const { type, row } of [...plan.adopt, ...plan.updateLocal]) {
          await db.table(ENTITY_TABLES[type]).put(row);
          adoptedIds.add(restKey(type, row.id));
          result.applied = (result.applied ?? 0) + 1;
        }
      } finally {
        suppressTombstones = false;
      }
      // Server-side deletions: delete locally WITHOUT suppression so the
      // delete hook records a tombstone — the push phase uploads it to the
      // vault and the mirror removes it from REST on other devices.
      for (const { type, id } of plan.apiDeleted) {
        await db.table(ENTITY_TABLES[type]).delete(id);
        result.applied = (result.applied ?? 0) + 1;
      }
      result.restAdopted = plan.adopt.length + plan.updateLocal.length;
    } catch (e) {
      result.restError = e instanceof Error ? e.message : String(e);
    }

    await setLastSyncAt(userId, newCursor);
  } catch (e) {
    return {
      status: "error",
      reason: `Pull failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // -- push -----------------------------------------------------------------
  try {
    const items: EncryptedEntityPush[] = [];
    // Full local entities per type, reused by the REST mirror below.
    const mirrorLocalByType = {} as Record<RestEntityType, MirrorEntity[]>;
    for (const type of SYNC_ENTITY_TYPES) {
      if (type === "setting") continue;
      const local = (await REPOS[type].list()) as {
        id: string;
        updatedAt: number;
      }[];
      mirrorLocalByType[type as RestEntityType] =
        local as unknown as MirrorEntity[];
      // Re-read full rows for encryption (list() already returns full entities).
      for (const e of local) {
        const { iv, ciphertext } = await encryptJson(key, e);
        items.push({
          entityType: type,
          entityId: e.id,
          iv,
          ciphertext,
          updatedAt: e.updatedAt,
          deleted: false,
        });
      }
    }
    // Tombstones: deletions recorded locally since the last push.
    const tombstones = await listTombstones(userId);
    for (const t of tombstones) {
      if (!SYNC_ENTITY_TYPES.includes(t.entityType as SyncEntityType)) continue;
      const { iv, ciphertext } = await encryptJson(key, null);
      items.push({
        entityType: t.entityType as SyncEntityType,
        entityId: t.entityId,
        iv,
        ciphertext,
        updatedAt: t.deletedAt,
        deleted: true,
      });
    }
    // Settings: push only when the document changed since the last push
    // (Settings carries no updatedAt — change detection by JSON compare).
    // Bookkeeping moves only AFTER postPush succeeds: marking settings as
    // pushed before the network call would silently drop the change on a
    // failed upload.
    const settings = await settingsRepo.get();
    const settingsJson = JSON.stringify(settings);
    const lastPushed = await getLastPushedSettings(userId);
    let settingsUpdatedAt = 0;
    if (settingsJson !== lastPushed) {
      const { iv, ciphertext } = await encryptJson(key, settings);
      settingsUpdatedAt = Date.now();
      items.push({
        entityType: "setting",
        entityId: SETTINGS_ENTITY_ID,
        iv,
        ciphertext,
        updatedAt: settingsUpdatedAt,
        deleted: false,
      });
    }

    const written = await postPush(items);
    result.pushed = written;
    if (settingsUpdatedAt > 0) {
      await setLastPushedSettings(userId, settingsJson);
      await setSettingsPushedAt(userId, settingsUpdatedAt);
    }

    // -- vault-state bookkeeping (push side) --------------------------------
    {
      const vs = await getVaultState(userId);
      for (const it of items) {
        const k = restKey(it.entityType, it.entityId);
        if (it.deleted) {
          vs.tombstoned[k] = it.updatedAt;
          delete vs.ids[k];
        } else {
          vs.ids[k] = Math.max(vs.ids[k] ?? 0, it.updatedAt);
          delete vs.tombstoned[k];
        }
      }
      await setVaultState(userId, vs);
    }

    // -- REST mirror (push direction) -----------------------------------------
    // Mirror Dexie state into the plaintext REST tables so the API/CLI sees
    // browser-created/edited/deleted data. Runs only after the vault push
    // succeeded. Tombstones are cleared only after the mirror succeeds too,
    // so a mirror failure retries cleanly next round (vault push is
    // idempotent under the server's last-write-wins).
    try {
      const mirrored = await loadMirroredState(userId);
      const mirrorPlan = planRestMirror({
        localByType: mirrorLocalByType,
        mirroredByType: mirrored,
        tombstones: tombstones
          .filter(
            (t) =>
              t.entityType !== "setting" &&
              (SYNC_ENTITY_TYPES as readonly string[]).includes(t.entityType),
          )
          .map((t) => ({
            entityType: t.entityType as RestEntityType,
            entityId: t.entityId,
            deletedAt: t.deletedAt,
          })),
        adoptedIds,
      });
      const m = await applyRestMirror(mirrorPlan);
      result.mirrored = m;
      for (const { type, entity } of [
        ...mirrorPlan.create,
        ...mirrorPlan.update,
      ]) {
        // The server honors client-supplied updatedAt (see validation.ts),
        // so the mirrored row carries the entity's own timestamp.
        mirrored[type].set(entity.id, entity.updatedAt);
      }
      for (const { type, id } of mirrorPlan.remove) mirrored[type].delete(id);
      await saveMirroredState(userId, mirrored);
    } catch (e) {
      return {
        status: "error",
        reason: `REST mirror failed: ${e instanceof Error ? e.message : String(e)}`,
        pulled: result.pulled,
        applied: result.applied,
        pushed: result.pushed,
      };
    }

    // Vault + REST are uploaded now — drop the tombstones (a re-pull would
    // re-apply the same tombstones idempotently anyway).
    for (const t of tombstones)
      await clearTombstone(userId, t.entityType, t.entityId);
  } catch (e) {
    return {
      status: "error",
      reason: `Push failed: ${e instanceof Error ? e.message : String(e)}`,
      pulled: result.pulled,
      applied: result.applied,
    };
  }

  return result;
}

// -- settings merge ----------------------------------------------------------

/**
 * Settings has no `updatedAt`, so it merges by "newer side wins" using the
 * tracked push timestamp: a remote settings snapshot wins when its
 * `updatedAt` is newer than our last push AND the payload differs from
 * local. (Called with tombstone suppression active.)
 */
async function applyRemoteSettings(
  _key: CryptoKey,
  snapshots: RemoteSnapshot[],
  userId: string,
  result: SyncResult,
): Promise<void> {
  const snap = snapshots
    .filter((s) => s.entityType === "setting" && !s.deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!snap) return;
  const pushedAt = await getSettingsPushedAt(userId);
  const local = await settingsRepo.get();
  const remoteJson = JSON.stringify(snap.entity);
  const localJson = JSON.stringify(local);
  if (remoteJson === localJson) {
    if (snap.updatedAt > pushedAt) await setSettingsPushedAt(userId, snap.updatedAt);
    return;
  }
  if (snap.updatedAt > pushedAt) {
    // Remote wins: full-document replace via a whole-object patch.
    await settingsRepo.update(snap.entity as Parameters<typeof settingsRepo.update>[0]);
    await setLastPushedSettings(userId, remoteJson);
    await setSettingsPushedAt(userId, snap.updatedAt);
    result.applied = (result.applied ?? 0) + 1;
  }
  // Else: local is newer (or unpushed) — the push phase uploads it.
}

/**
 * After a bundle import/reset replaces local data wholesale: diff the ids
 * the cloud knows about (full pull) against current local ids and record
 * tombstones for anything that vanished, so the next push tells the cloud
 * (and other devices) about the deletions instead of resurrecting them.
 * Best-effort — import/reset must never fail because sync did.
 */
export async function reconcileAfterLocalReplace(userId: string): Promise<void> {
  try {
    if (!isSyncEnabled()) return;
    const key = await getDataKey(userId);
    if (!key) return;
    const { rows } = await fetchPull(0);
    const db = getDB();
    for (const row of rows) {
      if (row.deleted || row.entityType === "setting") continue;
      if (!SYNC_ENTITY_TYPES.includes(row.entityType)) continue;
      const table = ENTITY_TABLES[row.entityType as Exclude<SyncEntityType, "setting">];
      const exists = (await db.table(table).get(row.entityId)) != null;
      if (!exists) {
        // The entity is gone locally and it isn't one of our own recent
        // tombstones → record a tombstone so the cloud learns the deletion.
        const ours = await getSyncDb()
          .tombstones.get([userId, row.entityType, row.entityId])
          .catch(() => undefined);
        if (!ours) await recordTombstone(userId, row.entityType, row.entityId);
      }
    }
  } catch {
    /* best-effort only */
  }
}