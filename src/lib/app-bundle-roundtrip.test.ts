// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbSingletonForTests, getDB } from "@/lib/db/schema";
import { clientRepo } from "@/lib/db/repos";
import {
  exportTallyhandBundleV1,
  importTallyhandBundleV1,
  parseTallyhandBundleV1,
  resetAllLocalData,
} from "@/lib/app-bundle";
import { exportMarkdownLedger, type LedgerExportTask } from "@/lib/ledger-export";
import type { Task } from "@/lib/db/types";

describe("tallyhand.v1 bundle", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete();
    resetDbSingletonForTests();
  });

  it("export → reset → import preserves clients and settings shape", async () => {
    await clientRepo.create({
      name: "Roundtrip LLC",
      archived: false,
    });
    const before = await exportTallyhandBundleV1();
    const raw = JSON.stringify(before);
    await resetAllLocalData();
    await importTallyhandBundleV1(parseTallyhandBundleV1(JSON.parse(raw)));
    const after = await exportTallyhandBundleV1();

    expect(after.format).toBe(before.format);
    expect(after.clients).toEqual(before.clients);
    expect(after.projects).toEqual(before.projects);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.expenses).toEqual(before.expenses);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.settings.id).toBe("singleton");
    expect(after.settings.business).toEqual(before.settings.business);
    expect(after.settings.invoice.numberPrefix).toBe(
      before.settings.invoice.numberPrefix,
    );
  });
});

describe("Markdown ledger export", () => {
  it("is byte-identical for the same rows at a fixed clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:30:00.000Z"));
    const task: Task = {
      id: "tsk_rt1",
      projectId: "prj_rt1",
      name: "Consulting",
      startAt: new Date("2024-06-10T10:00:00.000Z").getTime(),
      endAt: new Date("2024-06-10T11:00:00.000Z").getTime(),
      durationMinutes: 60,
      notes: "",
      tags: ["billable"],
      isBilled: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const row: LedgerExportTask = {
      kind: "task",
      task,
      clientName: "Acme",
      projectName: "Build",
    };
    const a = exportMarkdownLedger([row]);
    const b = exportMarkdownLedger([row]);
    expect(a).toBe(b);
    vi.useRealTimers();
  });
});
