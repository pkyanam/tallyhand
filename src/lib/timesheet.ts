import type { Client, Project, Task } from "@/lib/db/types";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function tasksForDay(tasks: Task[], dayStartMs: number): Task[] {
  const dayEndMs = dayStartMs + DAY_MS;
  return tasks
    .filter((task) => task.startAt >= dayStartMs && task.startAt < dayEndMs)
    .sort((a, b) => a.startAt - b.startAt);
}

export function weekDays(weekStartMs: number): number[] {
  return Array.from({ length: 7 }, (_, index) => weekStartMs + index * DAY_MS);
}

export type WeeklyTimesheetSummary = {
  totalMinutes: number;
  entryCount: number;
  unbilledMinutes: number;
  billedMinutes: number;
  unbilledAmount: number;
};

export function summarizeWeekTasks(
  tasks: Task[],
  projects: Project[],
  clients: Client[],
): WeeklyTimesheetSummary {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const clientById = new Map(clients.map((client) => [client.id, client]));

  return tasks.reduce<WeeklyTimesheetSummary>(
    (summary, task) => {
      const project = projectById.get(task.projectId);
      const client = project ? clientById.get(project.clientId) : undefined;
      const rate = project?.rateOverride ?? client?.defaultRate ?? 0;

      summary.totalMinutes += task.durationMinutes;
      summary.entryCount += 1;

      if (task.isBilled) {
        summary.billedMinutes += task.durationMinutes;
      } else {
        summary.unbilledMinutes += task.durationMinutes;
        summary.unbilledAmount += (task.durationMinutes / 60) * rate;
      }

      return summary;
    },
    {
      totalMinutes: 0,
      entryCount: 0,
      unbilledMinutes: 0,
      billedMinutes: 0,
      unbilledAmount: 0,
    },
  );
}
