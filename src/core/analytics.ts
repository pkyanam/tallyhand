/**
 * Analytics — pure calculations for the /analytics dashboard.
 *
 * Everything here is a pure function over plain entity arrays: no storage,
 * no network, no date "now" except where passed explicitly. Money stays in
 * decimal dollars (the invoice convention); formatting happens in the UI.
 */
import type {
  Client,
  Expense,
  ID,
  Invoice,
  Project,
  Task,
} from "./entities";
import { mileageDeduction, type MileageEntry } from "./mileage";

/** A timer is "complete" when it has a real end (endAt of 0 = still running). */
export function isCompleteTask(t: Task): boolean {
  return t.endAt > 0;
}

export function taskMinutes(t: Task): number {
  if (!isCompleteTask(t)) return 0;
  return t.durationMinutes ?? Math.max(0, Math.round((t.endAt - t.startAt) / 60_000));
}

/** Total billable minutes across completed tasks. */
export function totalBillableMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + taskMinutes(t), 0);
}

/**
 * Effective hourly rate = collected revenue / billable hours.
 * Returns null when there are no billable hours (avoids divide-by-zero).
 */
export function effectiveHourlyRate(
  collectedRevenue: number,
  billableMinutes: number,
): number | null {
  if (billableMinutes <= 0) return null;
  return collectedRevenue / (billableMinutes / 60);
}

/** Utilization % = billable minutes / target minutes (null when target is 0). */
export function utilizationPercent(
  billableMinutes: number,
  targetMinutes: number,
): number | null {
  if (targetMinutes <= 0) return null;
  return (billableMinutes / targetMinutes) * 100;
}

export interface MonthBucket {
  /** "YYYY-MM" in UTC. */
  month: string;
  /** Sum of totals for sent+paid invoices issued this month. */
  invoiced: number;
  /** Sum of totals for paid invoices issued this month. */
  collected: number;
}

export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Monthly revenue buckets ending with the month containing `nowMs`,
 * going back `monthCount` months. Invoiced counts sent + paid invoices by
 * issue date; collected counts only paid ones (cash view).
 */
export function revenueByMonth(
  invoices: Invoice[],
  monthCount: number,
  nowMs: number,
): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  const cursor = new Date(
    Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1),
  );
  for (let i = 0; i < monthCount; i++) {
    const key = monthKey(cursor.getTime());
    buckets.set(key, { month: key, invoiced: 0, collected: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  for (const inv of invoices) {
    if (inv.status === "draft") continue;
    const bucket = buckets.get(monthKey(inv.issueDate));
    if (!bucket) continue;
    bucket.invoiced += inv.total;
    if (inv.status === "paid") bucket.collected += inv.total;
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
}

export interface ClientProfitability {
  clientId: ID;
  clientName: string;
  revenue: number;
  expenses: number;
  mileageDeduction: number;
  hours: number;
  /** Collected revenue per billable hour; null when no hours. */
  effectiveRate: number | null;
  /** Revenue minus expenses minus mileage deduction. */
  profit: number;
}

/**
 * Per-client profitability. Revenue = paid invoices (cash basis).
 * Expenses count when linked to the client; mileage likewise.
 */
export function clientProfitability(
  clients: Client[],
  invoices: Invoice[],
  tasks: Task[],
  projectsById: Map<ID, Project>,
  expenses: Expense[],
  mileage: MileageEntry[],
): ClientProfitability[] {
  return clients
    .filter((c) => !c.archived)
    .map((client) => {
      const revenue = invoices
        .filter((i) => i.clientId === client.id && i.status === "paid")
        .reduce((sum, i) => sum + i.total, 0);
      const clientExpenses = expenses.filter(
        (e) => e.clientId === client.id,
      );
      const expenseTotal = clientExpenses.reduce((sum, e) => sum + e.amount, 0);
      const clientMileage = mileage.filter((m) => m.clientId === client.id);
      const mileageTotal = clientMileage.reduce(
        (sum, m) => sum + mileageDeduction(m),
        0,
      );
      const minutes = tasks
        .filter((t) => projectsById.get(t.projectId)?.clientId === client.id)
        .reduce((sum, t) => sum + taskMinutes(t), 0);
      const hours = minutes / 60;
      return {
        clientId: client.id,
        clientName: client.name,
        revenue,
        expenses: expenseTotal,
        mileageDeduction: mileageTotal,
        hours,
        effectiveRate: effectiveHourlyRate(revenue, minutes),
        profit: revenue - expenseTotal - mileageTotal,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

export interface ReceivablesSummary {
  /** Sent invoices not yet paid. */
  outstanding: number;
  outstandingCount: number;
  /** Of the outstanding, past due. */
  overdue: number;
  overdueCount: number;
}

export function outstandingReceivables(
  invoices: Invoice[],
  nowMs: number,
): ReceivablesSummary {
  let outstanding = 0;
  let outstandingCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const inv of invoices) {
    if (inv.status !== "sent") continue;
    outstanding += inv.total;
    outstandingCount++;
    if (inv.dueDate < nowMs) {
      overdue += inv.total;
      overdueCount++;
    }
  }
  return { outstanding, outstandingCount, overdue, overdueCount };
}

export interface BurnUpPoint {
  month: string;
  /** Cumulative collected revenue through this month. */
  cumulative: number;
  /** Cumulative target through this month. */
  target: number;
}

/**
 * Monthly target burn-up: cumulative collected revenue vs. a flat
 * per-month target, over the same window as `revenueByMonth`.
 */
export function monthlyTargetBurnUp(
  monthly: MonthBucket[],
  monthlyTarget: number,
): BurnUpPoint[] {
  let cumulative = 0;
  return monthly.map((m, i) => {
    cumulative += m.collected;
    return {
      month: m.month,
      cumulative,
      target: monthlyTarget * (i + 1),
    };
  });
}

/** Share of collected revenue vs. invoiced (collection efficiency). */
export function collectionRate(invoices: Invoice[]): number | null {
  let invoiced = 0;
  let collected = 0;
  for (const inv of invoices) {
    if (inv.status === "draft") continue;
    invoiced += inv.total;
    if (inv.status === "paid") collected += inv.total;
  }
  if (invoiced <= 0) return null;
  return (collected / invoiced) * 100;
}
