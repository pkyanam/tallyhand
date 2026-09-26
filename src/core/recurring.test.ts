import { describe, expect, it } from "vitest";
import {
  advanceSchedule,
  computeNextRun,
  describeFrequency,
  retainerUsage,
  type RecurringSchedule,
  type Retainer,
} from "./recurring";
import type { Project, Task } from "./entities";

const DAY = 86_400_000;

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  const start = Date.UTC(2026, 0, 15); // Jan 15 2026
  return {
    id: "rsd_1",
    clientId: "cli_1",
    name: "Monthly",
    mode: "fixed",
    frequency: "monthly",
    interval: 1,
    lineItems: [],
    startDate: start,
    nextRunAt: start,
    occurrences: 0,
    status: "active",
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  const startAt = Date.UTC(2026, 2, 10, 14, 0, 0);
  return {
    id: "tsk_1",
    projectId: "prj_1",
    name: "Work",
    startAt,
    endAt: startAt + 90 * 60_000,
    durationMinutes: 90,
    tags: [],
    isBilled: false,
    createdAt: startAt,
    updatedAt: startAt,
    ...overrides,
  };
}

describe("computeNextRun", () => {
  it("adds weeks by exact days", () => {
    const from = Date.UTC(2026, 0, 5, 9, 30, 0);
    expect(computeNextRun(from, "weekly", 1)).toBe(from + 7 * DAY);
    expect(computeNextRun(from, "weekly", 2)).toBe(from + 14 * DAY);
  });

  it("adds calendar months preserving the day", () => {
    const from = Date.UTC(2026, 0, 15, 10, 0, 0);
    expect(computeNextRun(from, "monthly", 1)).toBe(
      Date.UTC(2026, 1, 15, 10, 0, 0),
    );
    expect(computeNextRun(from, "monthly", 2)).toBe(
      Date.UTC(2026, 2, 15, 10, 0, 0),
    );
  });

  it("clamps Jan 31 + 1 month to Feb 28", () => {
    const from = Date.UTC(2026, 0, 31, 12, 0, 0);
    expect(computeNextRun(from, "monthly", 1)).toBe(
      Date.UTC(2026, 1, 28, 12, 0, 0),
    );
  });

  it("handles quarterly and yearly steps", () => {
    const from = Date.UTC(2026, 0, 10);
    expect(computeNextRun(from, "quarterly", 1)).toBe(Date.UTC(2026, 3, 10));
    expect(computeNextRun(from, "yearly", 1)).toBe(Date.UTC(2027, 0, 10));
    expect(computeNextRun(from, "yearly", 2)).toBe(Date.UTC(2028, 0, 10));
  });
});

describe("advanceSchedule", () => {
  it("advances nextRunAt, bumps occurrences, stamps lastRunAt", () => {
    const s = schedule();
    const now = Date.UTC(2026, 0, 16);
    const { patch, ended } = advanceSchedule(s, now);
    expect(ended).toBe(false);
    expect(patch.nextRunAt).toBe(Date.UTC(2026, 1, 15));
    expect(patch.occurrences).toBe(1);
    expect(patch.lastRunAt).toBe(now);
    expect(patch.status).toBeUndefined();
  });

  it("anchors to the previous nextRunAt, not now (no drift)", () => {
    const s = schedule({ frequency: "weekly", interval: 1 });
    const late = s.nextRunAt + 10 * DAY; // ran 10 days late
    const { patch } = advanceSchedule(s, late);
    expect(patch.nextRunAt).toBe(s.nextRunAt + 7 * DAY);
  });

  it("ends when maxOccurrences is reached", () => {
    const s = schedule({ maxOccurrences: 2, occurrences: 1 });
    const { patch, ended } = advanceSchedule(s, Date.now());
    expect(ended).toBe(true);
    expect(patch.status).toBe("ended");
    expect(patch.occurrences).toBe(2);
  });

  it("ends when the next run would pass endDate", () => {
    const s = schedule({
      frequency: "monthly",
      interval: 1,
      nextRunAt: Date.UTC(2026, 2, 15),
      endDate: Date.UTC(2026, 2, 20), // next run Apr 15 > Mar 20
    });
    const { patch, ended } = advanceSchedule(s, Date.now());
    expect(ended).toBe(true);
    expect(patch.status).toBe("ended");
  });

  it("stays active when the next run is still within endDate", () => {
    const s = schedule({
      frequency: "monthly",
      interval: 1,
      nextRunAt: Date.UTC(2026, 0, 15),
      endDate: Date.UTC(2026, 5, 30),
    });
    const { ended } = advanceSchedule(s, Date.now());
    expect(ended).toBe(false);
  });
});

describe("retainerUsage", () => {
  const project: Project = {
    id: "prj_1",
    clientId: "cli_1",
    name: "Site",
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  };
  const otherProject: Project = {
    ...project,
    id: "prj_2",
    clientId: "cli_2",
  };
  const projectsById = new Map([
    ["prj_1", project],
    ["prj_2", otherProject],
  ]);
  const retainer: Retainer = {
    id: "rtn_1",
    clientId: "cli_1",
    name: "Block",
    type: "prepaid-hours",
    totalHours: 10,
    amountCents: 50000,
    startDate: Date.UTC(2026, 0, 1),
    endDate: Date.UTC(2026, 11, 31),
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  };

  it("sums in-scope minutes and computes remaining + percent", () => {
    const usage = retainerUsage(retainer, [task(), task({ id: "tsk_2", durationMinutes: 30 })], projectsById);
    expect(usage.usedMinutes).toBe(120);
    expect(usage.remainingMinutes).toBe(480);
    expect(usage.percentUsed).toBeCloseTo(20, 5);
  });

  it("excludes other clients' tasks", () => {
    const usage = retainerUsage(
      retainer,
      [task({ id: "tsk_9", projectId: "prj_2" })],
      projectsById,
    );
    expect(usage.usedMinutes).toBe(0);
  });

  it("excludes tasks outside the retainer window", () => {
    const before = task({ id: "t_b", startAt: Date.UTC(2025, 11, 31) });
    const after = task({ id: "t_a", startAt: Date.UTC(2027, 0, 2) });
    const usage = retainerUsage(retainer, [before, after], projectsById);
    expect(usage.usedMinutes).toBe(0);
  });

  it("excludes open timers and prefers durationMinutes over recompute", () => {
    const open = task({ id: "t_o", endAt: null as unknown as number });
    const computed = task({
      id: "t_c",
      durationMinutes: undefined as unknown as number,
      startAt: Date.UTC(2026, 2, 10, 14, 0, 0),
      endAt: Date.UTC(2026, 2, 10, 15, 30, 0),
    });
    const usage = retainerUsage(retainer, [open, computed], projectsById);
    expect(usage.usedMinutes).toBe(90);
  });

  it("returns null remaining/percent when totalHours is undefined", () => {
    const usage = retainerUsage(
      { ...retainer, totalHours: undefined },
      [task()],
      projectsById,
    );
    expect(usage.usedMinutes).toBe(90);
    expect(usage.remainingMinutes).toBeNull();
    expect(usage.percentUsed).toBeNull();
  });
});

describe("describeFrequency", () => {
  it("labels singular and plural cadences", () => {
    expect(describeFrequency("weekly", 1)).toBe("Weekly");
    expect(describeFrequency("monthly", 1)).toBe("Monthly");
    expect(describeFrequency("quarterly", 1)).toBe("Quarterly");
    expect(describeFrequency("yearly", 1)).toBe("Yearly");
    expect(describeFrequency("weekly", 2)).toBe("Every 2 weeks");
    expect(describeFrequency("monthly", 3)).toBe("Every 3 months");
    expect(describeFrequency("quarterly", 2)).toBe("Every 2 quarters");
  });
});
