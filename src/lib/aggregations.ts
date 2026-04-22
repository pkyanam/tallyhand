import type { Client, Project, Task } from "@/lib/db/types";

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
