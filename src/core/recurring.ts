import type {
  ID,
  Project,
  Task,
  Timestamped,
} from "./entities";

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringMode = "fixed" | "unbilled";
export type RecurringStatus = "active" | "paused" | "ended";

export interface RecurringLineItem {
  description: string;
  quantity: number;
  rate: number;
}

export interface RecurringSchedule extends Timestamped {
  id: ID;
  clientId: ID;
  projectId?: ID;
  name: string;
  mode: RecurringMode;
  frequency: RecurringFrequency;
  interval: number;
  lineItems: RecurringLineItem[];
  startDate: number;
  endDate?: number;
  maxOccurrences?: number;
  nextRunAt: number;
  lastRunAt?: number;
  occurrences: number;
  status: RecurringStatus;
  notes?: string;
}

export type RecurringScheduleCreateInput = Omit<
  RecurringSchedule,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "nextRunAt"
  | "occurrences"
  | "status"
  | "lastRunAt"
> & { status?: RecurringStatus };

export type RetainerType = "prepaid-hours" | "monthly-fee";
export type RetainerStatus = "active" | "paused" | "depleted" | "ended";

export interface Retainer extends Timestamped {
  id: ID;
  clientId: ID;
  name: string;
  type: RetainerType;
  totalHours?: number;
  amountCents: number;
  hourlyRate?: number;
  startDate: number;
  endDate?: number;
  status: RetainerStatus;
  recurringScheduleId?: ID;
  notes?: string;
}

export type RetainerCreateInput = Omit<
  Retainer,
  "id" | "createdAt" | "updatedAt" | "status"
> & { status?: RetainerStatus };

const MS_PER_DAY = 86_400_000;

/** Add whole calendar months in UTC, clamping the day to the target month's end. */
function addMonthsUTC(fromMs: number, months: number): number {
  const d = new Date(fromMs);
  const targetMonth = d.getUTCMonth() + months;
  const targetYear =
    d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normMonth + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return Date.UTC(
    targetYear,
    normMonth,
    day,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/**
 * Compute the next run timestamp from a base timestamp, using UTC calendar
 * math. Monthly/quarterly/yearly steps clamp to the end of shorter months
 * (Jan 31 + 1 month → Feb 28/29).
 */
export function computeNextRun(
  fromMs: number,
  frequency: RecurringFrequency,
  interval: number,
): number {
  switch (frequency) {
    case "weekly":
      return fromMs + interval * 7 * MS_PER_DAY;
    case "monthly":
      return addMonthsUTC(fromMs, interval);
    case "quarterly":
      return addMonthsUTC(fromMs, interval * 3);
    case "yearly":
      return addMonthsUTC(fromMs, interval * 12);
  }
}

/**
 * Advance a schedule by one occurrence. Anchors the next run to the previous
 * `nextRunAt` (not "now") so the cadence never drifts when a run fires late.
 */
export function advanceSchedule(
  s: RecurringSchedule,
  nowMs: number,
): { patch: Partial<RecurringSchedule>; ended: boolean } {
  const nextRunAt = computeNextRun(s.nextRunAt, s.frequency, s.interval);
  const occurrences = s.occurrences + 1;
  const ended =
    (s.maxOccurrences != null && occurrences >= s.maxOccurrences) ||
    (s.endDate != null && nextRunAt > s.endDate);
  const patch: Partial<RecurringSchedule> = {
    nextRunAt,
    lastRunAt: nowMs,
    occurrences,
  };
  if (ended) patch.status = "ended";
  return { patch, ended };
}

export interface RetainerUsage {
  usedMinutes: number;
  remainingMinutes: number | null;
  percentUsed: number | null;
}

/**
 * Hours drawn against a retainer from tracked tasks: tasks whose project
 * belongs to the retainer's client, started inside the retainer window, with
 * a completed (non-open) timer.
 */
export function retainerUsage(
  retainer: Retainer,
  tasks: Task[],
  projectsById: Map<string, Project>,
): RetainerUsage {
  const end = retainer.endDate ?? Number.POSITIVE_INFINITY;
  let usedMinutes = 0;
  for (const t of tasks) {
    const project = projectsById.get(t.projectId);
    if (project?.clientId !== retainer.clientId) continue;
    if (t.startAt < retainer.startDate || t.startAt > end) continue;
    if (t.endAt == null) continue;
    usedMinutes +=
      t.durationMinutes ?? Math.round((t.endAt - t.startAt) / 60000);
  }
  const totalMinutes =
    retainer.totalHours != null ? retainer.totalHours * 60 : null;
  const remainingMinutes =
    totalMinutes != null ? Math.max(0, totalMinutes - usedMinutes) : null;
  const percentUsed =
    totalMinutes != null && totalMinutes > 0
      ? Math.min(100, (usedMinutes / totalMinutes) * 100)
      : null;
  return { usedMinutes, remainingMinutes, percentUsed };
}

/** Human label for a schedule's cadence, e.g. "Monthly" or "Every 3 months". */
export function describeFrequency(
  frequency: RecurringFrequency,
  interval: number,
): string {
  const unit =
    frequency === "weekly"
      ? "week"
      : frequency === "monthly"
        ? "month"
        : frequency === "quarterly"
          ? "quarter"
          : "year";
  if (interval <= 1) {
    return unit === "week"
      ? "Weekly"
      : unit === "month"
        ? "Monthly"
        : unit === "quarter"
          ? "Quarterly"
          : "Yearly";
  }
  return `Every ${interval} ${unit}s`;
}
