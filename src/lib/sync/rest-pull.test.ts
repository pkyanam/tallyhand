/**
 * Regression tests for REST → Dexie adoption in cloud mode.
 *
 * Covers the decision table in `src/lib/sync/rest-pull.ts`:
 * - unknown-local rows (not vault-tombstoned) are adopted, even when the
 *   vault knows the id with an older updatedAt
 * - REST rows strictly newer than local are updated; older/equal are no-ops
 * - vault-tombstoned ids are NEVER resurrected, even when REST is newer
 * - vault-known ids missing from REST are apiDeleted only when the local
 *   copy is unchanged-or-missing; a locally-newer row wins over the deletion
 */
import { describe, expect, it } from "vitest";
import {
  planRestAdoption,
  restKey,
  REST_PATHS,
  type RestEntityType,
  type RestRow,
} from "@/lib/sync/rest-pull";

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

const emptyMaps = () => {
  const m = {} as Record<RestEntityType, Map<string, number>>;
  for (const t of ALL_TYPES) m[t] = new Map();
  return m;
};

const emptyRows = () => {
  const r = {} as Record<RestEntityType, RestRow[]>;
  for (const t of ALL_TYPES) r[t] = [];
  return r;
};

const row = (id: string, updatedAt: number): RestRow => ({
  id,
  updatedAt,
  title: `row-${id}`,
});

describe("REST_PATHS", () => {
  it("maps every rest entity type to a non-empty /api/v1 path", () => {
    for (const t of ALL_TYPES) {
      expect(typeof REST_PATHS[t], t).toBe("string");
      expect(REST_PATHS[t].length, t).toBeGreaterThan(0);
      expect(REST_PATHS[t]).toMatch(/^\/api\/v1\//);
    }
  });

  it("restKey namespaces ids by entity type", () => {
    expect(restKey("task", "abc")).not.toBe(restKey("client", "abc"));
    expect(restKey("task", "abc")).toBe("task:abc");
  });
});

describe("planRestAdoption — adopt", () => {
  it("adopts a REST row unknown locally and not tombstoned", () => {
    const rest = emptyRows();
    rest.task = [row("t1", 100)];
    const plan = planRestAdoption({
      localByType: emptyMaps(),
      restByType: rest,
      vaultRows: new Map(),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt).toEqual([{ type: "task", row: rest.task[0] }]);
    expect(plan.updateLocal).toEqual([]);
    expect(plan.apiDeleted).toEqual([]);
  });

  it("adopts a REST row the vault knows with an older updatedAt (REST wins for the plaintext table)", () => {
    const rest = emptyRows();
    rest.task = [row("t1", 200)];
    const plan = planRestAdoption({
      localByType: emptyMaps(),
      restByType: rest,
      // Vault saw this row at t=100, but REST has it at t=200 and the local
      // Dexie has nothing: it must be adopted, not ignored as "already known".
      vaultRows: new Map([[restKey("task", "t1"), 100]]),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt.map((a) => a.row.id)).toEqual(["t1"]);
  });
});

describe("planRestAdoption — updateLocal", () => {
  it("updates local when the REST row is strictly newer", () => {
    const rest = emptyRows();
    rest.task = [row("t1", 200)];
    const local = emptyMaps();
    local.task.set("t1", 100);
    const plan = planRestAdoption({
      localByType: local,
      restByType: rest,
      vaultRows: new Map(),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([{ type: "task", row: rest.task[0] }]);
    expect(plan.apiDeleted).toEqual([]);
  });

  it("no-ops when the REST row is older or equal to local", () => {
    const rest = emptyRows();
    rest.task = [row("older", 50), row("equal", 100)];
    const local = emptyMaps();
    local.task.set("older", 100);
    local.task.set("equal", 100);
    const plan = planRestAdoption({
      localByType: local,
      restByType: rest,
      vaultRows: new Map(),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([]);
    expect(plan.apiDeleted).toEqual([]);
  });
});

describe("planRestAdoption — tombstone protection (no resurrection)", () => {
  it("never adopts a vault-tombstoned id present in REST, even when REST is newer", () => {
    const rest = emptyRows();
    rest.task = [row("t1", 500)];
    const local = emptyMaps();
    local.task.set("t1", 100);
    const plan = planRestAdoption({
      localByType: local,
      restByType: rest,
      vaultRows: new Map([[restKey("task", "t1"), 400]]),
      vaultTombstoned: new Set([restKey("task", "t1")]),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([]);
    expect(plan.apiDeleted).toEqual([]);
  });

  it("does not resurrect a tombstoned id that has no local copy either", () => {
    const rest = emptyRows();
    rest.task = [row("ghost", 999)];
    const plan = planRestAdoption({
      localByType: emptyMaps(),
      restByType: rest,
      vaultRows: new Map(),
      vaultTombstoned: new Set([restKey("task", "ghost")]),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([]);
  });
});

describe("planRestAdoption — apiDeleted", () => {
  it("marks a vault-known id missing from REST as deleted when local is unchanged", () => {
    const local = emptyMaps();
    local.task.set("t1", 100); // <= vault updatedAt → unchanged since vault saw it
    const plan = planRestAdoption({
      localByType: local,
      restByType: emptyRows(),
      vaultRows: new Map([[restKey("task", "t1"), 150]]),
      vaultTombstoned: new Set(),
    });
    expect(plan.apiDeleted).toEqual([{ type: "task", id: "t1" }]);
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([]);
  });

  it("marks a vault-known id missing from REST as deleted when there is no local copy", () => {
    const plan = planRestAdoption({
      localByType: emptyMaps(),
      restByType: emptyRows(),
      vaultRows: new Map([[restKey("task", "t1"), 150]]),
      vaultTombstoned: new Set(),
    });
    expect(plan.apiDeleted).toEqual([{ type: "task", id: "t1" }]);
  });

  it("does NOT mark a vault-known id missing from REST when local is newer (local edit wins)", () => {
    const local = emptyMaps();
    local.task.set("t1", 300); // > vault updatedAt → local was edited after the vault snapshot
    const plan = planRestAdoption({
      localByType: local,
      restByType: emptyRows(),
      vaultRows: new Map([[restKey("task", "t1"), 150]]),
      vaultTombstoned: new Set(),
    });
    expect(plan.apiDeleted).toEqual([]);
  });

  it("no-ops for ids absent from REST, local, and the vault alike", () => {
    const local = emptyMaps();
    local.task.set("lonely", 100); // local-only id, unknown to REST and vault
    const plan = planRestAdoption({
      localByType: local,
      restByType: emptyRows(),
      vaultRows: new Map(),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.updateLocal).toEqual([]);
    expect(plan.apiDeleted).toEqual([]);
  });

  it("handles a mixed batch: adopt + update + delete in one plan", () => {
    const rest = emptyRows();
    rest.task = [row("new", 100), row("stale-local", 300)];
    const local = emptyMaps();
    local.task.set("stale-local", 200);
    local.task.set("local-keep", 400);
    const plan = planRestAdoption({
      localByType: local,
      restByType: rest,
      vaultRows: new Map([
        [restKey("task", "stale-local"), 200],
        [restKey("task", "api-gone"), 250],
      ]),
      vaultTombstoned: new Set(),
    });
    expect(plan.adopt.map((a) => a.row.id)).toEqual(["new"]);
    expect(plan.updateLocal.map((u) => u.row.id)).toEqual(["stale-local"]);
    // api-gone is vault-known, missing from REST, no local copy → deleted
    expect(plan.apiDeleted).toEqual([{ type: "task", id: "api-gone" }]);
  });
});
