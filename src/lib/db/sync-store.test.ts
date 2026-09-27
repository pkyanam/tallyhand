import { describe, expect, it } from "vitest";
import { SYNC_ENTITY_TABLES, SYNC_ENTITY_TYPES } from "./sync-store";

describe("encrypted sync entity coverage", () => {
  it("covers every persisted entity, including the settings document", () => {
    expect(SYNC_ENTITY_TYPES).toEqual([
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
    ]);
  });

  it("maps every deletable entity to a tombstone-tracked local table", () => {
    expect(Object.keys(SYNC_ENTITY_TABLES).sort()).toEqual(
      SYNC_ENTITY_TYPES.filter((type) => type !== "setting").sort(),
    );
  });
});
