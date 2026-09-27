/**
 * Push-direction REST mirror: browser Dexie -> plaintext REST tables.
 *
 * In cloud mode the browser reads only the E2E-encrypted sync vault, which
 * the engine's runSync() push keeps up to date — but the plaintext Neon
 * tables behind the /api/v1/* REST API (what the API and CLI read) are a
 * separate store. This module mirrors browser state into those plaintext
 * tables so browser-created entities become visible to the API/CLI.
 *
 * Last-write-wins (LWW): planRestMirror compares each local entity's
 * updatedAt against the last successfully mirrored updatedAt for that id.
 * Only a strictly greater updatedAt produces an update; equal or older
 * means the two sides have converged and is a no-op — mirroring the vault
 * engine's rule that equal timestamps keep the stored row.
 *
 * No-resurrection: a tombstone always produces a DELETE even when the id is
 * in the mirrored map (the row was mirrored, then deleted locally), because
 * the mirrored copy must not outlive the local delete. Two races are
 * resolved against resurrection: (a) if the sibling REST->Dexie pass
 * adopted this id this round, adoption won — the tombstone is skipped, not
 * deleted; (b) if the same id exists locally with updatedAt newer than the
 * tombstone's deletedAt, the entity was re-created after the delete, so the
 * tombstone is stale and the entity is created/updated instead.
 *
 * Mirrored state (per-user id -> updatedAt) is persisted in the
 * tallyhand-sync Dexie meta table, but ONLY by the caller after
 * applyRestMirror succeeds — applyRestMirror itself never persists
 * anything, so a failed round retries cleanly on the next pass.
 *
 * CLIENT ONLY — IndexedDB (via getSyncDb) does not exist server-side.
 */

import type { SyncEntityType } from "@/lib/db/sync-store";
import { getSyncDb } from "@/lib/sync/sync-db";

export type RestEntityType = Exclude<SyncEntityType, "setting">;

export interface MirrorEntity {
  id: string;
  updatedAt: number;
  [k: string]: unknown;
}

export interface MirrorTombstone {
  entityType: RestEntityType;
  entityId: string;
  deletedAt: number;
}

export interface RestMirrorPlan {
  create: Array<{ type: RestEntityType; entity: MirrorEntity }>;
  update: Array<{ type: RestEntityType; entity: MirrorEntity }>;
  remove: Array<{ type: RestEntityType; id: string }>;
}

const REST_PATHS: Record<RestEntityType, string> = {
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

const BULK_PATHS: Partial<Record<RestEntityType, string>> = {
  task: "/api/v1/tasks/bulk",
  expense: "/api/v1/expenses/bulk",
  mileageEntry: "/api/v1/mileage/bulk",
  contract: "/api/v1/contracts/bulk",
  taxPayment: "/api/v1/tax-payments/bulk",
  rateCard: "/api/v1/rate-cards/bulk",
};

const REST_ENTITY_TYPES = Object.keys(REST_PATHS) as RestEntityType[];

export const restKey = (t: string, id: string): string => `${t}:${id}`;

export function planRestMirror(args: {
  localByType: Record<RestEntityType, MirrorEntity[]>;
  mirroredByType: Record<RestEntityType, Map<string, number>>;
  tombstones: MirrorTombstone[];
  adoptedIds: Set<string>;
}): RestMirrorPlan {
  const plan: RestMirrorPlan = { create: [], update: [], remove: [] };

  for (const tombstone of args.tombstones) {
    const key = restKey(tombstone.entityType, tombstone.entityId);
    if (args.adoptedIds.has(key)) continue;

    const localEntity = args.localByType[tombstone.entityType].find(
      (entity) => entity.id === tombstone.entityId,
    );

    // Last-write-wins uses updatedAt against deletedAt: a newer local
    // recreation wins over a stale deletion. Otherwise deletion wins.
    if (localEntity && localEntity.updatedAt > tombstone.deletedAt) {
      if (args.adoptedIds.has(key)) continue;

      const mirroredAt = args.mirroredByType[tombstone.entityType].get(localEntity.id);
      if (mirroredAt === undefined) {
        plan.create.push({ type: tombstone.entityType, entity: localEntity });
      } else if (localEntity.updatedAt > mirroredAt) {
        plan.update.push({ type: tombstone.entityType, entity: localEntity });
      }
      continue;
    }

    // No-resurrection: when adoption and deletion race, the adopted REST
    // entity wins and must not be removed by this round.
    plan.remove.push({ type: tombstone.entityType, id: tombstone.entityId });
  }

  for (const type of REST_ENTITY_TYPES) {
    for (const entity of args.localByType[type]) {
      const key = restKey(type, entity.id);
      if (args.adoptedIds.has(key)) continue;

      // A tombstone already decided this entity's outcome above.
      if (
        args.tombstones.some(
          (tombstone) =>
            tombstone.entityType === type && tombstone.entityId === entity.id,
        )
      ) {
        continue;
      }

      const mirroredAt = args.mirroredByType[type].get(entity.id);
      if (mirroredAt === undefined) {
        plan.create.push({ type, entity });
      } else if (entity.updatedAt > mirroredAt) {
        plan.update.push({ type, entity });
      }
    }
  }

  return plan;
}

function idempotencyHeaders(): HeadersInit {
  return { "Idempotency-Key": crypto.randomUUID() };
}

/**
 * The entity CRUD routes accept cookie sessions, but session-authed writes
 * must carry this custom header (cheap CSRF mitigation — a cross-site form
 * cannot set it). Sent on reads too: uniform and harmless.
 */
const SYNC_CSRF_HEADERS: HeadersInit = { "x-tallyhand-sync": "1" };

async function expectOk(
  response: Response,
  type: RestEntityType,
  id: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`REST mirror ${type} ${id} failed with HTTP ${response.status}`);
  }
}

async function patchEntity(
  type: RestEntityType,
  entity: MirrorEntity,
): Promise<void> {
  const response = await fetch(`${REST_PATHS[type]}/${encodeURIComponent(entity.id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...SYNC_CSRF_HEADERS,
      ...idempotencyHeaders(),
    },
    body: JSON.stringify(entity),
  });
  await expectOk(response, type, entity.id);
}

async function createEntity(
  type: RestEntityType,
  entity: MirrorEntity,
): Promise<"created" | "updated"> {
  const response = await fetch(REST_PATHS[type], {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...SYNC_CSRF_HEADERS,
      ...idempotencyHeaders(),
    },
    body: JSON.stringify(entity),
  });

  if (response.status === 409) {
    await patchEntity(type, entity);
    return "updated";
  }

  await expectOk(response, type, entity.id);
  return "created";
}

export async function applyRestMirror(
  plan: RestMirrorPlan,
): Promise<{ created: number; updated: number; removed: number }> {
  let created = 0;
  let updated = 0;
  let removed = 0;

  const createsByType = new Map<RestEntityType, MirrorEntity[]>();
  for (const item of plan.create) {
    const entities = createsByType.get(item.type) ?? [];
    entities.push(item.entity);
    createsByType.set(item.type, entities);
  }

  for (const type of REST_ENTITY_TYPES) {
    const entities = createsByType.get(type);
    if (!entities?.length) continue;

    const bulkPath = BULK_PATHS[type];
    if (!bulkPath) {
      for (const entity of entities) {
        const result = await createEntity(type, entity);
        if (result === "created") created += 1;
        else updated += 1;
      }
      continue;
    }

    const response = await fetch(bulkPath, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...SYNC_CSRF_HEADERS,
        ...idempotencyHeaders(),
      },
      body: JSON.stringify({ items: entities }),
    });

    if (response.status === 409) {
      for (const entity of entities) {
        const result = await createEntity(type, entity);
        if (result === "created") created += 1;
        else updated += 1;
      }
      continue;
    }

    await expectOk(response, type, entities.map((entity) => entity.id).join(","));
    created += entities.length;
  }

  for (const item of plan.update) {
    await patchEntity(item.type, item.entity);
    updated += 1;
  }

  for (const item of plan.remove) {
    const response = await fetch(
      `${REST_PATHS[item.type]}/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...SYNC_CSRF_HEADERS, ...idempotencyHeaders() },
      },
    );
    await expectOk(response, item.type, item.id);
    removed += 1;
  }

  return { created, updated, removed };
}

type SerializedMirrorState = Partial<
  Record<RestEntityType, Record<string, number>>
>;

function emptyMirroredState(): Record<RestEntityType, Map<string, number>> {
  return Object.fromEntries(
    REST_ENTITY_TYPES.map((type) => [type, new Map<string, number>()]),
  ) as Record<RestEntityType, Map<string, number>>;
}

export async function loadMirroredState(
  userId: string,
): Promise<Record<RestEntityType, Map<string, number>>> {
  const state = emptyMirroredState();
  const row = await getSyncDb().meta.get(`restMirror:${userId}`);
  if (!row) return state;

  try {
    const value: unknown =
      typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return state;
    }

    const serialized = value as SerializedMirrorState;
    for (const type of REST_ENTITY_TYPES) {
      const entries = serialized[type];
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        continue;
      }

      for (const [id, updatedAt] of Object.entries(entries)) {
        if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
          state[type].set(id, updatedAt);
        }
      }
    }
  } catch {
    return emptyMirroredState();
  }

  return state;
}

export async function saveMirroredState(
  userId: string,
  state: Record<RestEntityType, Map<string, number>>,
): Promise<void> {
  const serialized: Partial<Record<RestEntityType, Record<string, number>>> = {};

  for (const type of REST_ENTITY_TYPES) {
    serialized[type] = Object.fromEntries(state[type]);
  }

  await getSyncDb().meta.put({
    name: `restMirror:${userId}`,
    value: JSON.stringify(serialized),
  });
}
