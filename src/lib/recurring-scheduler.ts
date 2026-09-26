import { newId, newInvoicePublicToken } from "@/core/id";
import { advanceSchedule } from "@/core/recurring";
import {
  buildUnbilledLineItems,
  computeDueDate,
  computeLineAmount,
  invoiceTotals,
} from "@/core/invoice";
import {
  clientRepo,
  expenseRepo,
  invoiceRepo,
  projectRepo,
  recurringScheduleRepo,
  settingsRepo,
  taskRepo,
} from "@/lib/db/repos";
import { assignNextInvoiceNumber } from "@/lib/invoice-helpers";
import type { Invoice, InvoiceLineItem } from "@/core/entities";
import type { RecurringSchedule } from "@/core/recurring";

export interface RecurringScheduleRunResult {
  generated: Invoice[];
  skipped: { scheduleId: string; scheduleName: string; reason: string }[];
}

/** Control-flow for "skip this schedule, but it's not a failure". */
class ScheduleSkip extends Error {}

/**
 * Generate draft invoices for due recurring schedules.
 *
 * - Without `onlyScheduleId`: runs every `active` schedule whose `nextRunAt`
 *   has passed. Each due schedule produces at most one invoice per run;
 *   cadence stays anchored to the previous `nextRunAt`.
 * - With `onlyScheduleId`: "run now" — generates for that schedule regardless
 *   of due date or paused status (ended schedules are still refused).
 *
 * Generated invoices are drafts; the source tasks/expenses are claimed
 * (`isBilled: true`, `invoiceId` set) so they can't be billed twice. A
 * failing schedule is reported in `skipped` and never aborts the run.
 */
export async function runDueRecurringSchedules(
  nowMs: number = Date.now(),
  onlyScheduleId?: string,
): Promise<RecurringScheduleRunResult> {
  const generated: Invoice[] = [];
  const skipped: RecurringScheduleRunResult["skipped"] = [];

  let schedules: RecurringSchedule[];
  if (onlyScheduleId) {
    const one = await recurringScheduleRepo.get(onlyScheduleId);
    schedules = one ? [one] : [];
  } else {
    schedules = await recurringScheduleRepo.list("active");
  }

  for (const s of schedules) {
    try {
      if (s.status === "ended") {
        throw new ScheduleSkip("schedule has ended");
      }
      if (!onlyScheduleId && (s.status !== "active" || s.nextRunAt > nowMs)) {
        continue;
      }
      const invoice = await generateInvoiceForSchedule(s, nowMs);
      generated.push(invoice);
      const { patch } = advanceSchedule(s, nowMs);
      await recurringScheduleRepo.update(s.id, patch);
    } catch (err) {
      skipped.push({
        scheduleId: s.id,
        scheduleName: s.name,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { generated, skipped };
}

function buildFixedLineItems(s: RecurringSchedule): InvoiceLineItem[] {
  return s.lineItems
    .filter((l) => l.description.trim().length > 0 && l.quantity > 0)
    .map((l) => ({
      id: newId("li"),
      description: l.description.trim(),
      quantity: l.quantity,
      rate: l.rate,
      amount: computeLineAmount(l.quantity, l.rate),
      sourceType: "manual" as const,
    }));
}

async function buildUnbilledForSchedule(
  s: RecurringSchedule,
): Promise<InvoiceLineItem[]> {
  const [tasks, expenses, projects, clients] = await Promise.all([
    taskRepo.listUnbilled(),
    expenseRepo.list(),
    projectRepo.list(),
    clientRepo.list(true),
  ]);
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  const inScope = (
    projectId: string | undefined,
    expenseClientId?: string,
  ): boolean => {
    if (s.projectId) return projectId === s.projectId;
    if (projectId) return projectsById.get(projectId)?.clientId === s.clientId;
    return expenseClientId === s.clientId;
  };

  const scopedTasks = tasks.filter((t) => inScope(t.projectId));
  const scopedExpenses = expenses.filter(
    (e) => !e.isBilled && inScope(e.projectId, e.clientId),
  );
  return buildUnbilledLineItems(scopedTasks, scopedExpenses, projectsById, clientsById);
}

async function generateInvoiceForSchedule(
  s: RecurringSchedule,
  nowMs: number,
): Promise<Invoice> {
  const lineItems =
    s.mode === "fixed" ? buildFixedLineItems(s) : await buildUnbilledForSchedule(s);
  if (lineItems.length === 0) {
    throw new ScheduleSkip(
      s.mode === "fixed"
        ? "schedule has no line items"
        : "nothing unbilled to invoice",
    );
  }

  const settings = await settingsRepo.get();
  const invoiceNumber = await assignNextInvoiceNumber();
  const { subtotal, total } = invoiceTotals(lineItems);
  const invoice = await invoiceRepo.create({
    clientId: s.clientId,
    invoiceNumber,
    issueDate: nowMs,
    dueDate: computeDueDate(nowMs, settings.invoice.paymentTermsDays),
    status: "draft",
    lineItems,
    subtotal,
    total,
    notes: `Auto-generated from recurring schedule "${s.name}".`,
    publicToken: newInvoicePublicToken(),
  });

  // Claim the source work so it can't be billed twice. (Drafts created by
  // hand stay unclaimed until marked sent; auto-generated drafts claim
  // immediately because the scheduler can't ask the user first.)
  for (const li of lineItems) {
    if (!li.sourceId) continue;
    if (li.sourceType === "task") {
      await taskRepo.update(li.sourceId, {
        isBilled: true,
        invoiceId: invoice.id,
      });
    } else if (li.sourceType === "expense") {
      await expenseRepo.update(li.sourceId, {
        isBilled: true,
        invoiceId: invoice.id,
      });
    }
  }

  return invoice;
}
