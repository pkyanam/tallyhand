import { newId } from "@/core/id";
import type {
  Client,
  Expense,
  InvoiceLineItem,
  Project,
  Task,
} from "@/core/entities";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLineAmount(quantity: number, rate: number): number {
  return round2(quantity * rate);
}

/** Expense line: `rate` is the base (pre-markup) cost. */
export function computeExpenseLineAmount(
  baseRate: number,
  quantity: number,
  markupPercent?: number,
): number {
  const m = markupPercent ?? 0;
  return round2(quantity * baseRate * (1 + m / 100));
}

export function computeLineItemAmount(line: InvoiceLineItem): number {
  if (line.sourceType === "expense") {
    return computeExpenseLineAmount(
      line.rate,
      line.quantity,
      line.markupPercent,
    );
  }
  return computeLineAmount(line.quantity, line.rate);
}

export function sumLineItems(items: InvoiceLineItem[]): number {
  return round2(items.reduce((acc, it) => acc + (it.amount ?? 0), 0));
}

const MS_PER_DAY = 86_400_000;

export function computeDueDate(issueDate: number, termsDays: number): number {
  return issueDate + termsDays * MS_PER_DAY;
}

export function formatInvoiceNumber(prefix: string, next: number): string {
  return `${prefix}${next}`;
}

export function taskToLineItem(
  task: Task,
  project?: Project,
  client?: Client,
): InvoiceLineItem {
  const hours = round2(task.durationMinutes / 60);
  const rate = project?.rateOverride ?? client?.defaultRate ?? 0;
  return {
    id: newId("li"),
    description: task.name,
    quantity: hours,
    rate,
    amount: computeLineAmount(hours, rate),
    sourceType: "task",
    sourceId: task.id,
  };
}

export function expenseToLineItem(
  expense: Expense,
  options?: { markupPercent?: number },
): InvoiceLineItem {
  const description = expense.note
    ? `${expense.category} — ${expense.note}`
    : expense.category;
  const markup = options?.markupPercent;
  return {
    id: newId("li"),
    description,
    quantity: 1,
    rate: expense.amount,
    amount: computeExpenseLineAmount(expense.amount, 1, markup),
    sourceType: "expense",
    sourceId: expense.id,
    ...(markup != null && markup !== 0 ? { markupPercent: markup } : {}),
  };
}

export function makeManualLineItem(): InvoiceLineItem {
  return {
    id: newId("li"),
    description: "",
    quantity: 1,
    rate: 0,
    amount: 0,
    sourceType: "manual",
  };
}

export function inferClientIdFromSelection(
  tasks: Task[],
  expenses: Expense[],
  projects: Project[],
): string | undefined {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  for (const t of tasks) {
    const p = projectById.get(t.projectId);
    if (p?.clientId) return p.clientId;
  }
  for (const e of expenses) {
    if (e.clientId) return e.clientId;
    if (e.projectId) {
      const p = projectById.get(e.projectId);
      if (p?.clientId) return p.clientId;
    }
  }
  return undefined;
}

export function invoiceTotals(items: InvoiceLineItem[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = sumLineItems(items);
  return { subtotal, total: subtotal };
}

/**
 * Build invoice line items from unbilled work: tasks become hour-based lines
 * (rate = project override → client default), expenses become cost lines.
 * Pure — the caller decides which tasks/expenses are in scope.
 */
export function buildUnbilledLineItems(
  tasks: Task[],
  expenses: Expense[],
  projectsById: Map<string, Project>,
  clientsById: Map<string, Client>,
): InvoiceLineItem[] {
  const lineItems: InvoiceLineItem[] = [];
  for (const t of tasks) {
    const project = projectsById.get(t.projectId);
    const client = project ? clientsById.get(project.clientId) : undefined;
    lineItems.push(taskToLineItem(t, project, client));
  }
  for (const e of expenses) {
    lineItems.push(expenseToLineItem(e));
  }
  return lineItems;
}
