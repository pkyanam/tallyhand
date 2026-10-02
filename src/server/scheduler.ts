/**
 * SERVER ONLY — never import from client components.
 *
 * Recurring-invoice scheduler: turns due RecurringSchedules into draft
 * invoices. Used by POST /api/v1/scheduler/run and
 * POST /api/v1/recurring-schedules/[id]/run.
 *
 * Date math comes from the canonical `computeNextRun` in
 * `src/core/recurring.ts` (UTC calendar math, month-end clamping). The
 * catch-up policy in `advanceAfterRun` is scheduler-level policy: when a
 * schedule is past due, the next run advances straight to the first future
 * slot instead of generating one invoice per missed slot.
 *
 * Scheduler semantics (deliberate deviation from the UI flow, documented):
 * the manual invoice flow creates a draft and only marks source tasks/
 * expenses billed when the invoice is *sent*. The scheduler runs unattended,
 * so it *claims* its sources at generation time (isBilled + invoiceId) —
 * otherwise the next run would re-bill the same entries. Drafts still need
 * a human/agent to review and send.
 */
import { withInvoiceLinks } from "@/server/invoice-links";
import { newId } from "@/core/id";
import {
  computeDueDate,
  computeLineAmount,
  expenseToLineItem,
  invoiceTotals,
  taskToLineItem,
} from "@/core/invoice";
import { newInvoicePublicToken } from "@/core/id";
import type { InvoiceLineItem } from "@/core/entities";
import type { StorageProvider } from "@/core/storage";
import { computeNextRun } from "@/core/recurring";
import type { RecurringSchedule } from "@/core/recurring";

/**
 * The provider surface the scheduler needs. The canonical StorageProvider
 * already includes the recurring/retainer methods, so this is just an alias
 * kept for readability at the route call sites.
 */
export type RecurringCapableProvider = StorageProvider;

export interface ScheduleRunResult {
  scheduleId: string;
  /** Invoice created, or null when nothing was billable. */
  invoiceId: string | null;
  /** "empty" when the run found nothing to bill (still counts as an occurrence). */
  skipped: "empty" | null;
  nextRunAt: number;
  occurrences: number;
  status: RecurringSchedule["status"];
}

interface Generation {
  lineItems: InvoiceLineItem[];
  taskIds: string[];
  expenseIds: string[];
}

/** Build line items for one schedule run; collect source ids to claim. */
async function generateLineItems(
  provider: RecurringCapableProvider,
  schedule: RecurringSchedule,
): Promise<Generation> {
  const lineItems: InvoiceLineItem[] = [];
  const taskIds: string[] = [];
  const expenseIds: string[] = [];

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
    return { lineItems, taskIds, expenseIds };
  }

  // unbilled mode: sweep unbilled tasks/expenses for this client (and project, if set)
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
    const project = projectById.get(t.projectId);
    lineItems.push(taskToLineItem(t, project, client ?? undefined));
    taskIds.push(t.id);
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
    expenseIds.push(e.id);
  }

  return { lineItems, taskIds, expenseIds };
}

/**
 * Advance a schedule past one run: count the occurrence, move nextRunAt,
 * apply end conditions. Date steps use the canonical `computeNextRun` from
 * `@/core/recurring`; the catch-up loop is scheduler policy (see module
 * docstring) so a long-overdue schedule doesn't emit an invoice per missed
 * slot.
 */
function advanceAfterRun(
  schedule: RecurringSchedule,
  nowMs: number,
): Pick<RecurringSchedule, "occurrences" | "nextRunAt" | "lastRunAt" | "status"> {
  const occurrences = schedule.occurrences + 1;
  let nextRunAt = computeNextRun(schedule.nextRunAt, schedule.frequency, schedule.interval);
  // Catch up past-due slots without generating an invoice per missed slot.
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
  return { occurrences, nextRunAt, lastRunAt: nowMs, status };
}

/** Execute a single schedule run: maybe create a draft invoice, always advance. */
export async function runSchedule(
  provider: RecurringCapableProvider,
  schedule: RecurringSchedule,
  nowMs: number = Date.now(),
): Promise<ScheduleRunResult> {
  const { lineItems, taskIds, expenseIds } = await generateLineItems(provider, schedule);

  let invoiceId: string | null = null;
  let skipped: "empty" | null = null;

  if (lineItems.length === 0) {
    skipped = "empty";
  } else {
    const settings = await provider.getSettings();
    const { subtotal, total } = invoiceTotals(lineItems);
    const invoiceNumber = await provider.assignNextInvoiceNumber();
    const issueDate = nowMs;
    const invoice = await provider.createInvoice({
      clientId: schedule.clientId,
      invoiceNumber,
      issueDate,
      dueDate: computeDueDate(issueDate, settings.invoice.paymentTermsDays),
      status: "draft",
      lineItems,
      subtotal,
      total,
      notes: `Auto-generated from recurring schedule "${schedule.name}". Review before sending.`,
      publicToken: newInvoicePublicToken(),
      cloudLinkEnabled: true,
    });
    // Claim sources now: the scheduler is unattended, so reserving the
    // entries prevents the next run from billing them twice. (The UI flow
    // claims on send instead — see module docstring.)
    for (const tid of taskIds) {
      await provider.updateTask(tid, { isBilled: true, invoiceId: invoice.id });
    }
    for (const eid of expenseIds) {
      await provider.updateExpense(eid, { isBilled: true, invoiceId: invoice.id });
    }
    await withInvoiceLinks(invoice, true);
    invoiceId = invoice.id;
  }

  const advanced = advanceAfterRun(schedule, nowMs);
  await provider.updateRecurringSchedule(schedule.id, advanced);

  return {
    scheduleId: schedule.id,
    invoiceId,
    skipped,
    nextRunAt: advanced.nextRunAt,
    occurrences: advanced.occurrences,
    status: advanced.status,
  };
}

/** Run one schedule by id (force-run: works even if not due or paused). Returns null when missing. */
export async function runScheduleNow(
  provider: RecurringCapableProvider,
  scheduleId: string,
  nowMs: number = Date.now(),
): Promise<ScheduleRunResult | null> {
  const schedule = await provider.getRecurringSchedule(scheduleId);
  if (!schedule) return null;
  return runSchedule(provider, schedule, nowMs);
}

/** Run every active schedule whose nextRunAt is due. */
export async function runDueSchedules(
  provider: RecurringCapableProvider,
  nowMs: number = Date.now(),
): Promise<{ generated: string[]; results: ScheduleRunResult[] }> {
  const due = (await provider.listRecurringSchedules("active")).filter(
    (s) => s.nextRunAt <= nowMs,
  );
  const results: ScheduleRunResult[] = [];
  const generated: string[] = [];
  for (const schedule of due) {
    const result = await runSchedule(provider, schedule, nowMs);
    results.push(result);
    if (result.invoiceId) generated.push(result.invoiceId);
  }
  return { generated, results };
}
