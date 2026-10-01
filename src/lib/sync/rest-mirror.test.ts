/**
 * Regression tests for Dexie → REST mirroring in cloud mode.
 *
 * Covers the decision table in `src/lib/sync/rest-mirror.ts`:
 * - new local ids (not mirrored, not adopted) are created
 * - strictly newer local rows are updated; equal/older are no-ops
 * - tombstones always remove, even when the mirrored copy is newer
 * - adopted ids are skipped everywhere to prevent the write-back loop
 * - a tombstoned id that was adopted skips removal (adoption won)
 *
 * `applyRestMirror` is tested against a mocked `fetch`; it must POST task
 * creates to a single `/bulk` request, PATCH `/api/v1/tasks/{id}` for
 * updates, DELETE for removes, send an `Idempotency-Key` header on every
 * mutation, and fall back to PATCH when a bulk POST returns 409.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRestMirror,
  planRestMirror,
  restKey,
  type MirrorEntity,
  type MirrorTombstone,
  type RestEntityType,
  type RestMirrorPlan,
} from "@/lib/sync/rest-mirror";

const ALL_TYPES: RestEntityType[] = [
  "client",
  "project",
  "task",
  "expense",
  "invoice",
  "recurringSchedule",
  "retainer",
  "mileageEntry",
  "contract",
  "taxPayment",
  "rateCard",
];

const emptyEntities = () => {
  const m = {} as Record<RestEntityType, MirrorEntity[]>;
  for (const t of ALL_TYPES) m[t] = [];
  return m;
};

const emptyMirrored = () => {
  const m = {} as Record<RestEntityType, Map<string, number>>;
  for (const t of ALL_TYPES) m[t] = new Map();
  return m;
};

const entity = (id: string, updatedAt: number): MirrorEntity => ({
  id,
  updatedAt,
  title: `row-${id}`,
});

const tomb = (
  entityType: RestEntityType,
  entityId: string,
  deletedAt = 100,
): MirrorTombstone => ({ entityType, entityId, deletedAt });

describe("restKey", () => {
  it("namespaces ids by entity type", () => {
    expect(restKey("task", "abc")).not.toBe(restKey("client", "abc"));
    expect(restKey("task", "abc")).toBe("task:abc");
  });
});

describe("planRestMirror — create", () => {
  it("creates new local ids that were neither mirrored nor adopted", () => {
    const local = emptyEntities();
    local.task = [entity("n1", 100), entity("n2", 100)];
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: emptyMirrored(),
      tombstones: [],
      adoptedIds: new Set(),
    });
    expect(plan.create.map((c) => c.entity.id).sort()).toEqual(["n1", "n2"]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});

describe("planRestMirror — update", () => {
  it("updates when local is strictly newer than the mirrored copy", () => {
    const local = emptyEntities();
    local.task = [entity("t1", 200)];
    const mirrored = emptyMirrored();
    mirrored.task.set("t1", 100);
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: mirrored,
      tombstones: [],
      adoptedIds: new Set(),
    });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ type: "task", entity: local.task[0] }]);
    expect(plan.remove).toEqual([]);
  });

  it("no-ops when local is equal to or older than the mirrored copy", () => {
    const local = emptyEntities();
    local.task = [entity("same", 100), entity("stale", 50)];
    const mirrored = emptyMirrored();
    mirrored.task.set("same", 100);
    mirrored.task.set("stale", 100);
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: mirrored,
      tombstones: [],
      adoptedIds: new Set(),
    });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});

describe("planRestMirror — remove", () => {
  it("removes tombstoned ids even when the mirrored copy is newer", () => {
    const mirrored = emptyMirrored();
    mirrored.task.set("gone", 500);
    const plan = planRestMirror({
      localByType: emptyEntities(),
      mirroredByType: mirrored,
      tombstones: [tomb("task", "gone", 100)],
      adoptedIds: new Set(),
    });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([{ type: "task", id: "gone" }]);
  });

  it("removes tombstoned ids that were never mirrored", () => {
    const plan = planRestMirror({
      localByType: emptyEntities(),
      mirroredByType: emptyMirrored(),
      tombstones: [tomb("task", "ghost")],
      adoptedIds: new Set(),
    });
    expect(plan.remove).toEqual([{ type: "task", id: "ghost" }]);
  });

  it("recreates rather than removes when a local row is newer than the tombstone's deletedAt (LWW)", () => {
    const local = emptyEntities();
    local.task = [entity("recreated", 300)];
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: emptyMirrored(),
      tombstones: [tomb("task", "recreated", 100)],
      adoptedIds: new Set(),
    });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([{ type: "task", entity: local.task[0] }]);
  });
});

describe("planRestMirror — adopted ids skip everything", () => {
  it("skips adopted ids on create/update/remove to prevent the write-back loop", () => {
    const local = emptyEntities();
    // freshly adopted locally (updatedAt 300, never mirrored)
    local.task = [entity("adopted-new", 300), entity("adopted-old", 100)];
    const mirrored = emptyMirrored();
    // adopted-new not mirrored → would be create; adopted-old mirrored older → would be update
    mirrored.task.set("adopted-old", 50);
    const adoptedIds = new Set([restKey("task", "adopted-new"), restKey("task", "adopted-old")]);
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: mirrored,
      tombstones: [
        tomb("task", "adopted-new", 400),
        tomb("task", "adopted-old", 400),
      ],
      adoptedIds,
    });
    // No create, no update, no remove for adopted ids — adopting a REST row
    // must never echo it back to REST.
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("still mirrors non-adopted ids alongside adopted ones", () => {
    const local = emptyEntities();
    local.task = [entity("mine", 100), entity("theirs", 100)];
    const plan = planRestMirror({
      localByType: local,
      mirroredByType: emptyMirrored(),
      tombstones: [],
      adoptedIds: new Set([restKey("task", "theirs")]),
    });
    expect(plan.create.map((c) => c.entity.id)).toEqual(["mine"]);
  });
});

describe("applyRestMirror", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const jsonOk = (body: unknown = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  interface SeenRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
  }

  const captureFetch = (
    respond: (req: SeenRequest) => Response | Promise<Response>,
  ) => {
    const seen: SeenRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: RequestInit = {}) => {
        let body: unknown = init.body;
        try {
          body = typeof init.body === "string" ? JSON.parse(init.body) : body;
        } catch {
          /* leave raw */
        }
        const req: SeenRequest = {
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          headers: new Headers(init.headers as HeadersInit | undefined),
          body,
        };
        seen.push(req);
        return respond(req);
      }),
    );
    return seen;
  };

  it("batches task creates into one /bulk POST, PATCHes updates, DELETEs removes, and sends Idempotency-Key on every mutation", async () => {
    const seen = captureFetch(() => jsonOk({}));
    const plan: RestMirrorPlan = {
      create: [
        { type: "task", entity: entity("n1", 100) },
        { type: "task", entity: entity("n2", 100) },
      ],
      update: [{ type: "task", entity: entity("u1", 200) }],
      remove: [{ type: "task", id: "d1" }],
    };
    const result = await applyRestMirror(plan);
    expect(result).toEqual({ created: 2, updated: 1, removed: 1 });

    const posts = seen.filter((r) => r.method === "POST");
    // One bulk request for all task creates — not one POST per entity.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/bulk");
    expect(posts[0].url).toContain("task");
    // The bulk envelope carries the entities under `items`.
    const bulkItems = (posts[0].body as { items: MirrorEntity[] }).items;
    expect(Array.isArray(bulkItems)).toBe(true);
    expect(bulkItems.map((e) => e.id).sort()).toEqual(["n1", "n2"]);

    const patches = seen.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toContain("/api/v1/tasks/u1");

    const deletes = seen.filter((r) => r.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain("/api/v1/tasks/d1");

    // Every mutation carries an idempotency key.
    for (const r of seen) {
      expect(r.headers.get("Idempotency-Key"), `${r.method} ${r.url}`).toBeTruthy();
    }

    // Every mutation carries the session-write CSRF header.
    for (const r of seen) {
      expect(r.headers.get("x-tallyhand-sync"), `${r.method} ${r.url}`).toBe("1");
    }
  });

  it.each(["task", "expense", "mileageEntry", "contract", "taxPayment", "rateCard"] as const)("splits large %s uploads into bounded batches without losing rows", async (type) => {
    const seen = captureFetch((req) => {
      const items = (req.body as { items: MirrorEntity[] }).items;
      return items.length > 200
        ? new Response("too many items", { status: 400 })
        : jsonOk({});
    });
    const entities = Array.from({ length: 401 }, (_, i) => entity(`row-${i}`, 100));
    await expect(applyRestMirror({
      create: entities.map((item) => ({ type, entity: item })),
      update: [], remove: [],
    })).resolves.toEqual({ created: 401, updated: 0, removed: 0 });
    const batches = seen.map((req) => (req.body as { items: MirrorEntity[] }).items);
    expect(batches.map((items) => items.length)).toEqual([200, 200, 1]);
    expect(batches.flat().map((item) => item.id)).toEqual(entities.map((item) => item.id));
  });

  it("retries per-entity POSTs to the collection endpoint when the bulk POST returns 409", async () => {
    const seen = captureFetch((req) => {
      if (req.method === "POST" && req.url.includes("/bulk")) {
        return new Response("conflict", { status: 409 });
      }
      return jsonOk({});
    });
    const plan: RestMirrorPlan = {
      create: [
        { type: "task", entity: entity("n1", 100) },
        { type: "task", entity: entity("n2", 100) },
      ],
      update: [],
      remove: [],
    };
    const result = await applyRestMirror(plan);
    expect(result.created).toBe(2);

    // One failed bulk POST, then one singular POST per entity to the
    // collection endpoint (not /bulk).
    const posts = seen.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(3);
    const singles = posts.filter((r) => !r.url.includes("/bulk"));
    expect(singles).toHaveLength(2);
    expect(singles[0].url).toBe("/api/v1/tasks");
    expect(singles[1].url).toBe("/api/v1/tasks");
    expect(seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
    for (const r of seen) {
      expect(r.headers.get("Idempotency-Key"), `${r.method} ${r.url}`).toBeTruthy();
    }
  });

  it("falls back to PATCH per entity when both the bulk and the singular POST return 409", async () => {
    const seen = captureFetch((req) => {
      if (req.method === "POST") {
        return new Response("conflict", { status: 409 });
      }
      return jsonOk({});
    });
    const plan: RestMirrorPlan = {
      create: [
        { type: "task", entity: entity("n1", 100) },
        { type: "task", entity: entity("n2", 100) },
      ],
      update: [],
      remove: [],
    };
    const result = await applyRestMirror(plan);
    // Singular 409 means the row already exists → counted as updated via PATCH.
    expect(result.created).toBe(0);
    expect(result.updated).toBe(2);

    const patches = seen.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0].url).toContain("/api/v1/tasks/n1");
    expect(patches[1].url).toContain("/api/v1/tasks/n2");
    for (const r of seen) {
      expect(r.headers.get("Idempotency-Key"), `${r.method} ${r.url}`).toBeTruthy();
    }
  });

  it("no-ops on an empty plan without touching the network", async () => {
    const seen = captureFetch(() => jsonOk({}));
    const result = await applyRestMirror({ create: [], update: [], remove: [] });
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(seen).toHaveLength(0);
  });
});
