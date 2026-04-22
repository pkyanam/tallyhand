import { describe, expect, it } from "vitest";
import {
  detectGaps,
  minutesOverlapWorkWindow,
  recentEntries,
  startOfWeekMonday,
  unbilledByClient,
  weekTotalMinutes,
} from "@/lib/aggregations";
import type { Client, Project, Task } from "@/lib/db/types";

const monday = new Date(2026, 3, 20, 12, 0, 0); // Apr 20 2026 = Monday

function task(partial: Partial<Task> & Pick<Task, "id" | "projectId">): Task {
  return {
    id: partial.id,
    projectId: partial.projectId,
    name: partial.name ?? "Work",
    startAt: partial.startAt ?? monday.getTime(),
    endAt: partial.endAt ?? monday.getTime() + 3600000,
    durationMinutes: partial.durationMinutes ?? 60,
    notes: partial.notes,
    tags: partial.tags ?? [],
    isBilled: partial.isBilled ?? false,
    invoiceId: partial.invoiceId,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("startOfWeekMonday", () => {
  it("returns Monday 00:00 for a Wednesday in the same week", () => {
    const wed = new Date(2026, 3, 22, 15, 30, 0); // Wed Apr 22
    const start = startOfWeekMonday(wed);
    const d = new Date(start);
    expect(d.getDay()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(20);
  });
});

describe("weekTotalMinutes", () => {
  const ws = startOfWeekMonday(monday);
  it("sums duration for tasks starting on or after week start", () => {
    const before = task({
      id: "tsk_before",
      projectId: "prj",
      startAt: ws - 86400000,
      durationMinutes: 120,
    });
    const inWeek = task({
      id: "tsk_in",
      projectId: "prj",
      startAt: ws + 3600000,
      durationMinutes: 45,
    });
    expect(weekTotalMinutes([before, inWeek], ws)).toBe(45);
  });
});

describe("unbilledByClient", () => {
  const clients: Client[] = [
    {
      id: "cli_a",
      name: "Acme",
      defaultRate: 100,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "cli_b",
      name: "Beta",
      defaultRate: 50,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const projects: Project[] = [
    {
      id: "prj_a",
      clientId: "cli_a",
      name: "P1",
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "prj_b",
      clientId: "cli_b",
      name: "P2",
      rateOverride: 200,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ];

  it("aggregates unbilled dollars and sorts by amount desc", () => {
    const tasks: Task[] = [
      task({
        id: "t1",
        projectId: "prj_a",
        durationMinutes: 60,
        isBilled: false,
      }),
      task({
        id: "t2",
        projectId: "prj_b",
        durationMinutes: 120,
        isBilled: false,
      }),
      task({
        id: "t3",
        projectId: "prj_a",
        durationMinutes: 60,
        isBilled: true,
      }),
    ];
    const rows = unbilledByClient(tasks, projects, clients);
    expect(rows).toHaveLength(2);
    expect(rows[0].clientId).toBe("cli_b");
    expect(rows[0].amount).toBe(400);
    expect(rows[1].clientId).toBe("cli_a");
    expect(rows[1].amount).toBe(100);
  });
});

describe("minutesOverlapWorkWindow", () => {
  it("returns full overlap minutes when task sits inside window", () => {
    const winStart = new Date(2026, 3, 21, 9, 0, 0, 0).getTime();
    const winEnd = new Date(2026, 3, 21, 17, 0, 0, 0).getTime();
    const t0 = new Date(2026, 3, 21, 10, 0, 0, 0).getTime();
    const t1 = new Date(2026, 3, 21, 11, 0, 0, 0).getTime();
    expect(minutesOverlapWorkWindow(t0, t1, winStart, winEnd)).toBe(60);
  });
});

describe("detectGaps", () => {
  it("flags a weekday when under 2h fall inside 9–5", () => {
    const wed = new Date(2026, 3, 22, 12, 0, 0);
    const ws = startOfWeekMonday(wed);
    const winStart = new Date(2026, 3, 21, 9, 0, 0, 0).getTime();
    const tasks = [
      task({
        id: "g",
        projectId: "prj",
        startAt: winStart + 3600000,
        endAt: winStart + 2 * 3600000,
        durationMinutes: 60,
      }),
    ];
    const gaps = detectGaps(wed, tasks);
    const mon = gaps.find((g) => g.dayStartMs === ws);
    const tue = gaps.find((g) => g.dayStartMs === ws + 86400000);
    expect(mon?.isGap).toBe(true);
    expect(mon?.minutesInWindow).toBe(0);
    expect(tue?.minutesInWindow).toBe(60);
    expect(tue?.isGap).toBe(true);
  });
});

describe("recentEntries", () => {
  it("returns newest tasks first up to limit", () => {
    const tasks: Task[] = [
      task({ id: "a", projectId: "p", startAt: 1000, durationMinutes: 1 }),
      task({ id: "b", projectId: "p", startAt: 3000, durationMinutes: 1 }),
      task({ id: "c", projectId: "p", startAt: 2000, durationMinutes: 1 }),
    ];
    const r = recentEntries(tasks, 2);
    expect(r.map((t) => t.id)).toEqual(["b", "c"]);
  });
});
