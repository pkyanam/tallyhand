/**
 * Last-write-wins merge tests for encrypted sync.
 *
 * Covers the decision table in `src/lib/sync/merge.ts`:
 * strictly-newer wins (either side), equal timestamps are a no-op,
 * tombstones delete only when newer than the local row, and a locally
 * newer row survives a stale remote tombstone (correct resurrection).
 */
import { describe, expect, it } from "vitest";
import {
  decideEntityMerge,
  planPullMerge,
  type RemoteSnapshot,
} from "@/lib/sync/merge";

const snap = (
  entityId: string,
  updatedAt: number,
  deleted = false,
): RemoteSnapshot => ({ entityType: "task", entityId, updatedAt, deleted });

describe("decideEntityMerge", () => {
  it("inserts remote rows that don't exist locally", () => {
    expect(decideEntityMerge(undefined, 10, false)).toBe("apply-remote");
  });
  it("ignores tombstones for entities already absent", () => {
    expect(decideEntityMerge(undefined, 10, true)).toBe("noop");
  });
  it("applies strictly newer remote rows", () => {
    expect(decideEntityMerge(5, 10, false)).toBe("apply-remote");
  });
  it("keeps strictly newer local rows (they get pushed)", () => {
    expect(decideEntityMerge(10, 5, false)).toBe("keep-local");
  });
  it("treats equal timestamps as converged", () => {
    expect(decideEntityMerge(10, 10, false)).toBe("noop");
  });
  it("applies a newer remote tombstone (deletes locally)", () => {
    expect(decideEntityMerge(5, 10, true)).toBe("apply-remote");
  });
  it("keeps the local row when it is newer than a remote tombstone", () => {
    // Device B edited at t=10; device A deleted at t=5. LWW: the edit wins
    // and the push phase resurrects it on the server.
    expect(decideEntityMerge(10, 5, true)).toBe("keep-local");
  });
  it("no-ops on a tombstone with an equal timestamp (delete already propagated)", () => {
    expect(decideEntityMerge(10, 10, true)).toBe("noop");
  });
});

describe("planPullMerge", () => {
  it("plans a mixed batch correctly", () => {
    const local = new Map([
      ["keep", 20], // local newer → push
      ["update", 5], // remote newer → apply
      ["same", 10], // equal → nothing
      ["del", 5], // remote tombstone newer → apply (delete)
      ["del-stale", 30], // remote tombstone older → keep-local
    ]);
    const remote = [
      snap("keep", 10),
      snap("update", 15),
      snap("same", 10),
      snap("new", 12),
      snap("del", 9, true),
      snap("del-stale", 8, true),
      snap("gone", 3, true), // tombstone, nothing local → noop
    ];
    const plan = planPullMerge(local, remote);
    expect(plan.apply.map((s) => s.entityId).sort()).toEqual([
      "del",
      "new",
      "update",
    ]);
    expect(plan.pushIds.sort()).toEqual(["del-stale", "keep"]);
  });

  it("handles an empty pull", () => {
    const plan = planPullMerge(new Map([["a", 1]]), []);
    expect(plan.apply).toEqual([]);
    expect(plan.pushIds).toEqual([]);
  });
});
