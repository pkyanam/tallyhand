import { describe, expect, it } from "vitest";
import { summarizeWeekTasks, tasksForDay, weekDays } from "@/lib/timesheet";
import type { Client, Project, Task } from "@/lib/db/types";

const monday = new Date(2026, 3, 20, 0, 0, 0, 0).getTime();

function task(partial: Partial<Task> & Pick<Task, "id" | "projectId">): Task {
  return {
    id: partial.id,
    projectId: partial.projectId,
    name: partial.name ?? "Work",
    startAt: partial.startAt ?? monday,
    endAt: partial.endAt ?? monday + 60 * 60 * 1000,
    durationMinutes: partial.durationMinutes ?? 60,
    notes: partial.notes,
    tags: partial.tags ?? [],
    isBilled: partial.isBilled ?? false,
    invoiceId: partial.invoiceId,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("weekDays", () => {
  it("returns seven consecutive day starts", () => {
    const days = weekDays(monday);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(monday);
    expect(days[6]).toBe(monday + 6 * 24 * 60 * 60 * 1000);
  });
});

describe("tasksForDay", () => {
  it("keeps only tasks that start on the requested day and sorts them", () => {
    const dayTwo = monday + 24 * 60 * 60 * 1000;
    const rows = tasksForDay(
      [
        task({ id: "late", projectId: "prj", startAt: dayTwo + 4_000 }),
        task({ id: "other", projectId: "prj", startAt: monday + 4_000 }),
        task({ id: "early", projectId: "prj", startAt: dayTwo + 1_000 }),
      ],
      dayTwo,
    );

    expect(rows.map((row) => row.id)).toEqual(["early", "late"]);
  });
});

describe("summarizeWeekTasks", () => {
  it("totals billed and unbilled minutes and value", () => {
    const clients: Client[] = [
      {
        id: "cli_1",
        name: "Acme",
        defaultRate: 120,
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const projects: Project[] = [
      {
        id: "prj_1",
        clientId: "cli_1",
        name: "Website",
        rateOverride: 150,
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const summary = summarizeWeekTasks(
      [
        task({
          id: "a",
          projectId: "prj_1",
          durationMinutes: 60,
          isBilled: false,
        }),
        task({
          id: "b",
          projectId: "prj_1",
          durationMinutes: 30,
          isBilled: true,
        }),
      ],
      projects,
      clients,
    );

    expect(summary).toEqual({
      totalMinutes: 90,
      entryCount: 2,
      unbilledMinutes: 60,
      billedMinutes: 30,
      unbilledAmount: 150,
    });
  });
});
