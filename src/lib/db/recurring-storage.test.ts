// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, resetDbSingletonForTests } from "@/lib/db/schema";
import { DexieStorageProvider } from "@/lib/db/dexie-provider";
import type { StorageProvider } from "@/core/storage";

/**
 * StorageProvider conformance for recurring schedules + retainers,
 * exercised against the Dexie implementation (schema v3).
 */
describe("DexieStorageProvider — recurring schedules & retainers", () => {
  let provider: StorageProvider;

  beforeEach(async () => {
    const db = getDB();
    await db.delete();
    resetDbSingletonForTests();
    provider = new DexieStorageProvider();
  });

  const scheduleInput = (clientId: string) => ({
    clientId,
    name: "Monthly retainer",
    mode: "fixed" as const,
    frequency: "monthly" as const,
    interval: 1,
    lineItems: [{ description: "Retainer", quantity: 1, rate: 500 }],
    startDate: Date.UTC(2026, 0, 15),
  });

  const retainerInput = (clientId: string) => ({
    clientId,
    name: "Hours block",
    type: "prepaid-hours" as const,
    totalHours: 20,
    amountCents: 100000,
    startDate: Date.UTC(2026, 0, 1),
  });

  describe("recurring schedules", () => {
    it("creates with documented defaults", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const s = await provider.createRecurringSchedule(
        scheduleInput(client.id),
      );
      expect(s.id).toMatch(/^rsd_/);
      expect(s.status).toBe("active");
      expect(s.nextRunAt).toBe(s.startDate);
      expect(s.occurrences).toBe(0);
      expect(s.lastRunAt).toBeUndefined();
      expect(s.createdAt).toBeGreaterThan(0);
      expect(s.updatedAt).toBe(s.createdAt);

      expect(await provider.getRecurringSchedule(s.id)).toEqual(s);
      expect(await provider.getRecurringSchedule("rsd_nope")).toBeUndefined();
    });

    it("lists, filters by status and client, updates, removes", async () => {
      const a = await provider.createClient({ name: "A" });
      const b = await provider.createClient({ name: "B" });
      const s1 = await provider.createRecurringSchedule(scheduleInput(a.id));
      const s2 = await provider.createRecurringSchedule(scheduleInput(b.id));
      await provider.updateRecurringSchedule(s2.id, { status: "paused" });

      expect(await provider.listRecurringSchedules()).toHaveLength(2);
      expect(await provider.listRecurringSchedules("active")).toHaveLength(1);
      expect(await provider.listRecurringSchedules("paused")).toHaveLength(1);
      expect(
        (await provider.listRecurringSchedulesByClient(a.id)).map((s) => s.id),
      ).toEqual([s1.id]);

      await provider.updateRecurringSchedule(s1.id, { occurrences: 3 });
      const updated = await provider.getRecurringSchedule(s1.id);
      expect(updated?.occurrences).toBe(3);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(s1.updatedAt);

      await provider.removeRecurringSchedule(s1.id);
      expect(await provider.getRecurringSchedule(s1.id)).toBeUndefined();
      expect(await provider.listRecurringSchedules()).toHaveLength(1);
    });

    it("orders by nextRunAt ascending", async () => {
      const c = await provider.createClient({ name: "A" });
      const later = await provider.createRecurringSchedule({
        ...scheduleInput(c.id),
        name: "later",
        startDate: Date.UTC(2026, 5, 1),
      });
      const sooner = await provider.createRecurringSchedule({
        ...scheduleInput(c.id),
        name: "sooner",
        startDate: Date.UTC(2026, 0, 1),
      });
      const listed = await provider.listRecurringSchedules();
      expect(listed.map((s) => s.id)).toEqual([sooner.id, later.id]);
    });
  });

  describe("retainers", () => {
    it("creates with documented defaults", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const r = await provider.createRetainer(retainerInput(client.id));
      expect(r.id).toMatch(/^rtn_/);
      expect(r.status).toBe("active");
      expect(r.createdAt).toBeGreaterThan(0);
      expect(r.updatedAt).toBe(r.createdAt);

      expect(await provider.getRetainer(r.id)).toEqual(r);
      expect(await provider.getRetainer("rtn_nope")).toBeUndefined();
    });

    it("lists, filters by status and client, updates, removes", async () => {
      const a = await provider.createClient({ name: "A" });
      const b = await provider.createClient({ name: "B" });
      const r1 = await provider.createRetainer(retainerInput(a.id));
      const r2 = await provider.createRetainer({
        ...retainerInput(b.id),
        type: "monthly-fee",
        totalHours: undefined,
      });
      await provider.updateRetainer(r2.id, { status: "paused" });

      expect(await provider.listRetainers()).toHaveLength(2);
      expect(await provider.listRetainers("active")).toHaveLength(1);
      expect(
        (await provider.listRetainersByClient(a.id)).map((r) => r.id),
      ).toEqual([r1.id]);

      await provider.updateRetainer(r1.id, {
        status: "depleted",
        recurringScheduleId: "rsd_x",
      });
      const updated = await provider.getRetainer(r1.id);
      expect(updated?.status).toBe("depleted");
      expect(updated?.recurringScheduleId).toBe("rsd_x");

      await provider.removeRetainer(r1.id);
      expect(await provider.getRetainer(r1.id)).toBeUndefined();
    });
  });
});
