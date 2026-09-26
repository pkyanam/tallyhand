/**
 * API v1 dry-run previews for recurring-schedule runs (route-private:
 * `_lib` is not a route).
 *
 * Read-only mirror of the server scheduler's run logic: computes what
 * `POST /scheduler/run` (or `/recurring-schedules/[id]/run`) WOULD do —
 * line items, estimated total, advanced nextRunAt/occurrences — without
 * creating invoices, claiming sources, or advancing the schedule.
 *
 * Lives here instead of `src/server/scheduler.ts` because that module is
 * outside the API layer's ownership. The generation logic is intentionally
 * kept in lockstep with the server's `generateLineItems`/`advanceAfterRun`
 * (same filters, same `@/core` line-item builders, same catch-up policy):
 * any behavior change there must be mirrored here.
 */
import { newId } from "@/core/id";
import {
  computeLineAmount,
  expenseToLineItem,
  invoiceTotals,
  taskToLineItem,
} from "@/core/invoice";
import { computeNextRun } from "@/core/recurring";
import type { RecurringSchedule } from "@/core/recurring";
import type { InvoiceLineItem } from "@/core/entities";
import type { StorageProvider } from "@/core/storage";

export interface ScheduleRunPreview {
  scheduleId: string;
  name: string;
  /** True when the run would create a draft invoice. */
  wouldCreateInvoice: boolean;
  lineItemCount: number;
  estimatedTotal: number;
  nextRunAt: number;
  occurrences: number;
  status: RecurringSchedule["status"];
}

/**
 * Build the line items one schedule run would generate (no writes).
 * Mirrors the server scheduler's generation: fixed mode copies the
 * schedule's line items; unbilled mode sweeps unbilled tasks/expenses for
 * this client (and project, when set).
 */
async function previewLineItems(
  provider: StorageProvider,
  schedule: RecurringSchedule,
): Promise<InvoiceLineItem[]> {
  const lineItems: InvoiceLineItem[] = [];

  if (schedule.mode === "fixed") {
    for (const li of schedule.lineItems) {
      lineItems.push({
        id: newId("li"),
        description: li.description,
        quantity: li.quantity,
        rate: li.rate,
        amount: computeLineAmount(li.quantity, li.rate),
        sourceType: "manual",
      });
    }
    return lineItems;
  }

  const projects = await provider.listProjects();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const client = await provider.getClient(schedule.clientId);

  const tasks = (await provider.listUnbilledTasks()).filter((t) => {
    const project = projectById.get(t.projectId);
    if (!project || project.clientId !== schedule.clientId) return false;
    if (schedule.projectId && t.projectId !== schedule.projectId) return false;
    return true;
  });
  for (const t of tasks) {
    lineItems.push(taskToLineItem(t, projectById.get(t.projectId), client ?? undefined));
  }

  const expenses = (await provider.listExpenses()).filter((e) => {
    if (e.isBilled) return false;
    const project = e.projectId ? projectById.get(e.projectId) : undefined;
    const ownerClientId = e.clientId ?? project?.clientId;
    if (ownerClientId !== schedule.clientId) return false;
    if (schedule.projectId && e.projectId !== schedule.projectId) return false;
    return true;
  });
  for (const e of expenses) {
    lineItems.push(expenseToLineItem(e));
  }

  return lineItems;
}

/**
 * Compute the post-run schedule state without persisting it. Same catch-up
 * policy as the server: a past-due schedule jumps to the first future slot
 * instead of emitting one invoice per missed slot; end conditions
 * (maxOccurrences / endDate) flip status to "ended".
 */
function previewAdvance(
  schedule: RecurringSchedule,
  nowMs: number,
): Pick<RecurringSchedule, "occurrences" | "nextRunAt" | "status"> {
  const occurrences = schedule.occurrences + 1;
  let nextRunAt = computeNextRun(schedule.nextRunAt, schedule.frequency, schedule.interval);
  let guard = 0;
  while (nextRunAt <= nowMs && guard++ < 1200) {
    nextRunAt = computeNextRun(nextRunAt, schedule.frequency, schedule.interval);
  }
  let status = schedule.status;
  if (
    (schedule.maxOccurrences != null && occurrences >= schedule.maxOccurrences) ||
    (schedule.endDate != null && nextRunAt > schedule.endDate)
  ) {
    status = "ended";
  }
  return { occurrences, nextRunAt, status };
}

/** Preview what running one schedule would do, without writing anything. */
export async function previewScheduleRun(
  provider: StorageProvider,
  schedule: RecurringSchedule,
  nowMs: number = Date.now(),
): Promise<ScheduleRunPreview> {
  const lineItems = await previewLineItems(provider, schedule);
  const { total } = invoiceTotals(lineItems);
  const advanced = previewAdvance(schedule, nowMs);
  return {
    scheduleId: schedule.id,
    name: schedule.name,
    wouldCreateInvoice: lineItems.length > 0,
    lineItemCount: lineItems.length,
    estimatedTotal: total,
    nextRunAt: advanced.nextRunAt,
    occurrences: advanced.occurrences,
    status: advanced.status,
  };
}

/** Preview every active schedule whose nextRunAt is due, without running. */
export async function previewDueSchedules(
  provider: StorageProvider,
  nowMs: number = Date.now(),
): Promise<ScheduleRunPreview[]> {
  const due = (await provider.listRecurringSchedules("active")).filter(
    (s) => s.nextRunAt <= nowMs,
  );
  const previews: ScheduleRunPreview[] = [];
  for (const schedule of due) {
    previews.push(await previewScheduleRun(provider, schedule, nowMs));
  }
  return previews;
}
