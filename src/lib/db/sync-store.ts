/**
 * Encrypted-sync server store — the ciphertext half of end-to-end encrypted
 * sync. Implemented by the Postgres-backed providers (postgres + neon);
 * the Dexie/SQLite/Convex providers do not implement it and the sync REST
 * routes answer 501 there.
 *
 * The server never sees plaintext: rows carry only base64 `iv` +
 * `ciphertext` produced client-side with the user's AES-GCM-256 data key.
 * Per-user scoping is enforced by the provider (every query carries
 * `user_id = <session user>`, exactly like every other hosted table).
 */
import type { ID } from "@/core/entities";

/**
 * Entity types synced through the encrypted vault. "time entries" are
 * `task`s; `setting` is the singleton settings document (entity id
 * `"settings"`).
 */
export const SYNC_ENTITY_TYPES = [
  "client",
  "project",
  "task",
  "expense",
  "invoice",
  "setting",
  "recurringSchedule",
  "retainer",
  "mileageEntry",
  "contract",
  "taxPayment",
  "rateCard",
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export function isSyncEntityType(v: unknown): v is SyncEntityType {
  return (
    typeof v === "string" &&
    (SYNC_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

/** One encrypted entity snapshot, as stored server-side. */
export interface EncryptedEntityRow {
  userId: string;
  entityType: SyncEntityType;
  entityId: ID;
  /** base64 96-bit AES-GCM IV */
  iv: string;
  /** base64 AES-GCM ciphertext of the entity JSON */
  ciphertext: string;
  /** client-supplied ms epoch; drives last-write-wins */
  updatedAt: number;
  /** tombstone: the entity was deleted on the pushing device */
  deleted: boolean;
}

/** Client push payload: the row minus userId (the server fills it in). */
export type EncryptedEntityPush = Omit<EncryptedEntityRow, "userId">;

export interface EncryptedSyncStore {
  /**
   * Upsert a batch of encrypted snapshots for the provider's user.
   * Last-write-wins: a row is written only when `updatedAt` is strictly
   * newer than the stored one (equal timestamps keep the stored row —
   * deterministic across devices pushing identical payloads).
   * Returns the number of rows actually written.
   */
  upsertEncryptedEntities(items: EncryptedEntityPush[]): Promise<number>;
  /**
   * List snapshots for the provider's user updated strictly after `since`
   * (ms epoch), optionally restricted to entity types. Ascending by
   * (updatedAt, entityId) so the client can page with the `after` keyset
   * cursor — exact even under timestamp collisions at a page boundary.
   */
  listEncryptedEntitiesSince(
    since: number,
    entityTypes?: SyncEntityType[],
    limit?: number,
    /** Keyset cursor: the last row of the previous page. */
    after?: { updatedAt: number; entityId: string },
  ): Promise<EncryptedEntityRow[]>;
  /** Count snapshots for the provider's user (sync status UI). */
  countEncryptedEntities(): Promise<number>;
}

/** Capability check for StorageProvider instances (dexie/sqlite/convex lack it). */
export function isEncryptedSyncStore(v: unknown): v is EncryptedSyncStore {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { upsertEncryptedEntities?: unknown })
      .upsertEncryptedEntities === "function" &&
    typeof (v as { listEncryptedEntitiesSince?: unknown })
      .listEncryptedEntitiesSince === "function"
  );
}
