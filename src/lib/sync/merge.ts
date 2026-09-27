/**
 * Pure last-write-wins merge core for encrypted sync.
 *
 * No I/O, no crypto, no IndexedDB — the sync engine (`engine.ts`) feeds it
 * local `updatedAt` values and decrypted remote snapshots, and applies the
 * resulting plan to Dexie. Pure so the merge semantics are unit-testable
 * without a browser (see `merge.test.ts`).
 */
import type { SyncEntityType } from "@/lib/db/sync-store";

/** A decrypted remote snapshot (ciphertext already opened with the DEK). */
export interface RemoteSnapshot<T = unknown> {
  entityType: SyncEntityType;
  entityId: string;
  updatedAt: number;
  deleted: boolean;
  /** undefined when `deleted` (tombstones carry no payload) */
  entity?: T;
}

export type MergeAction =
  /** Remote is strictly newer: upsert locally, or delete locally on tombstone. */
  | "apply-remote"
  /** Local is strictly newer: the push phase will upload it (server LWW agrees). */
  | "keep-local"
  /** Same timestamp (or remote tombstone for an already-absent entity): nothing to do. */
  | "noop";

/**
 * Decide one entity's merge. `localUpdatedAt` is undefined when the entity
 * does not exist locally.
 *
 * - Remote tombstone + nothing local → noop (already converged).
 * - Remote tombstone + local entity:
 *   remote newer → apply-remote (delete locally);
 *   local newer → keep-local (push resurrects it — correct LWW);
 *   equal → noop (deterministic tie-break: the delete already propagated).
 * - Both present: strictly newer `updatedAt` wins; equal → noop.
 */
export function decideEntityMerge(
  localUpdatedAt: number | undefined,
  remoteUpdatedAt: number,
  remoteDeleted: boolean,
): MergeAction {
  if (localUpdatedAt === undefined) {
    return remoteDeleted ? "noop" : "apply-remote";
  }
  if (remoteUpdatedAt > localUpdatedAt) return "apply-remote";
  if (remoteUpdatedAt < localUpdatedAt) return "keep-local";
  return "noop";
}

export interface MergePlan<T = unknown> {
  /** Remote snapshots to write into the local store (in pull order). */
  apply: RemoteSnapshot<T>[];
  /**
   * Local entity ids that are strictly newer than their remote snapshot
   * and must be pushed. (The engine pushes the whole local store anyway —
   * the server re-applies LWW — so this is informational/for tests.)
   */
  pushIds: string[];
}

/**
 * Plan a whole pull batch. `localById` maps entity id → local `updatedAt`
 * for ONE entity type; `remote` holds that type's snapshots (any order).
 */
export function planPullMerge<T>(
  localById: Map<string, number>,
  remote: RemoteSnapshot<T>[],
): MergePlan<T> {
  const apply: RemoteSnapshot<T>[] = [];
  const pushIds: string[] = [];
  for (const snap of remote) {
    const action = decideEntityMerge(
      localById.get(snap.entityId),
      snap.updatedAt,
      snap.deleted,
    );
    if (action === "apply-remote") apply.push(snap);
    else if (action === "keep-local") pushIds.push(snap.entityId);
  }
  return { apply, pushIds };
}
