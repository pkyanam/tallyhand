import type { Client, Expense, Project, Task } from "@/lib/db/types";

/** Monday 00:00 local for the week containing `date`. */
export function startOfWeekMonday(date: Date): number {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function weekTotalMinutes(
  tasks: Task[],
  weekStartMs: number,
): number {
  let mins = 0;
  for (const t of tasks) {
    if (t.startAt >= weekStartMs) mins += t.durationMinutes;
  }
  return mins;
}

export type UnbilledClientRow = {
  clientId: string;
  clientName: string;
  amount: number;
};

/**
 * Sums unbilled task value by client using effective hourly rate
 * (project override, else client default).
 */
export function unbilledByClient(
  tasks: Task[],
  projects: Project[],
  clients: Client[],
): UnbilledClientRow[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const totals = new Map<string, { name: string; amount: number }>();

  for (const t of tasks) {
    if (t.isBilled) continue;
    const p = projectById.get(t.projectId);
    if (!p) continue;
    const c = clientById.get(p.clientId);
    const name = c?.name ?? "Unknown client";
    const rate = p.rateOverride ?? c?.defaultRate ?? 0;
    const amount = (t.durationMinutes / 60) * rate;
    const prev = totals.get(p.clientId);
    if (prev) prev.amount += amount;
    else totals.set(p.clientId, { name, amount });
  }

  return Array.from(totals.entries())
    .map(([clientId, v]) => ({
      clientId,
      clientName: v.name,
      amount: v.amount,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function recentEntries(tasks: Task[], limit = 10): Task[] {
  const sorted = [...tasks].sort((a, b) => b.startAt - a.startAt);
  return sorted.slice(0, limit);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function tasksInWeekRange(
  tasks: Task[],
  weekStartMs: number,
): Task[] {
  const weekEndMs = weekStartMs + WEEK_MS;
  return tasks.filter(
    (t) => t.startAt >= weekStartMs && t.startAt < weekEndMs,
  );
}

export function expensesInWeekRange(
  expenses: Expense[],
  weekStartMs: number,
): Expense[] {
  const weekEndMs = weekStartMs + WEEK_MS;
  return expenses.filter(
    (e) => e.date >= weekStartMs && e.date < weekEndMs,
  );
}

/** Overlap of [rangeStart, rangeEnd] with [winStart, winEnd] in minutes. */
export function minutesOverlapWorkWindow(
  rangeStart: number,
  rangeEnd: number,
  winStart: number,
  winEnd: number,
): number {
  const lo = Math.max(rangeStart, winStart);
  const hi = Math.min(rangeEnd, winEnd);
  if (hi <= lo) return 0;
  return Math.round((hi - lo) / 60000);
}

export type WeekdayGap = {
  dayStartMs: number;
  label: string;
  minutesInWindow: number;
  isGap: boolean;
};

/**
 * For Mon–Fri of the week containing `now`, sums tracked minutes overlapping
 * each day’s 09:00–17:00 local window. Flags gaps when total is under 2 hours.
 */
export function detectGaps(now: Date, tasks: Task[]): WeekdayGap[] {
  const weekStart = startOfWeekMonday(now);
  const out: WeekdayGap[] = [];
  for (let d = 0; d < 5; d++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    const y = day.getFullYear();
    const m = day.getMonth();
    const date = day.getDate();
    const winStart = new Date(y, m, date, 9, 0, 0, 0).getTime();
    const winEnd = new Date(y, m, date, 17, 0, 0, 0).getTime();
    const dayStartMs = new Date(y, m, date, 0, 0, 0, 0).getTime();
    let minutesInWindow = 0;
    for (const t of tasks) {
      minutesInWindow += minutesOverlapWorkWindow(
        t.startAt,
        t.endAt,
        winStart,
        winEnd,
      );
    }
    const label = day.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    out.push({
      dayStartMs,
      label,
      minutesInWindow,
      isGap: minutesInWindow < 120,
    });
  }
  return out;
}

export type WeeklyReckoningSummary = {
  weekStartMs: number;
  weekEndMs: number;
  trackedWeekMinutes: number;
  unbilledTaskAmountByClient: UnbilledClientRow[];
  weekExpenseTotal: number;
  weekUnbilledExpenseTotal: number;
};

export function weeklyReckoningSummary(
  now: Date,
  tasks: Task[],
  expenses: Expense[],
  projects: Project[],
  clients: Client[],
): WeeklyReckoningSummary {
  const weekStartMs = startOfWeekMonday(now);
  const weekEndMs = weekStartMs + WEEK_MS;
  const inWeekTasks = tasksInWeekRange(tasks, weekStartMs);
  const trackedWeekMinutes = inWeekTasks.reduce(
    (a, t) => a + t.durationMinutes,
    0,
  );
  const weekExps = expensesInWeekRange(expenses, weekStartMs);
  const weekExpenseTotal = weekExps.reduce((a, e) => a + e.amount, 0);
  const weekUnbilledExpenseTotal = weekExps
    .filter((e) => !e.isBilled)
    .reduce((a, e) => a + e.amount, 0);
  const unbilledTaskAmountByClient = unbilledByClient(
    tasks,
    projects,
    clients,
  );
  return {
    weekStartMs,
    weekEndMs,
    trackedWeekMinutes,
    unbilledTaskAmountByClient,
    weekExpenseTotal,
    weekUnbilledExpenseTotal,
  };
}

export function unbilledTaskIdsForClient(
  clientId: string,
  tasks: Task[],
  projects: Project[],
): string[] {
  const projectIds = new Set(
    projects.filter((p) => p.clientId === clientId).map((p) => p.id),
  );
  return tasks
    .filter((t) => !t.isBilled && projectIds.has(t.projectId))
    .map((t) => t.id);
}

export function unbilledExpenseIdsForClient(
  clientId: string,
  expenses: Expense[],
  projects: Project[],
): string[] {
  const projectIds = new Set(
    projects.filter((p) => p.clientId === clientId).map((p) => p.id),
  );
  return expenses
    .filter((e) => {
      if (e.isBilled) return false;
      if (e.clientId === clientId) return true;
      if (e.projectId && projectIds.has(e.projectId)) return true;
      return false;
    })
    .map((e) => e.id);
}
