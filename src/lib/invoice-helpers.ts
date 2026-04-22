import { newId } from "@/lib/db/id";
import { getDB } from "@/lib/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/db/types";
import type {
  Client,
  Expense,
  Invoice,
  InvoiceLineItem,
  Project,
  Settings,
  Task,
} from "@/lib/db/types";

const MS_PER_DAY = 86_400_000;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLineAmount(quantity: number, rate: number): number {
  return round2(quantity * rate);
}

export function sumLineItems(items: InvoiceLineItem[]): number {
  return round2(items.reduce((acc, it) => acc + (it.amount ?? 0), 0));
}

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

export function expenseToLineItem(expense: Expense): InvoiceLineItem {
  const description = expense.note
    ? `${expense.category} — ${expense.note}`
    : expense.category;
  return {
    id: newId("li"),
    description,
    quantity: 1,
    rate: expense.amount,
    amount: expense.amount,
    sourceType: "expense",
    sourceId: expense.id,
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

/**
 * Reads settings, formats the next invoice number, bumps nextNumber, and
 * persists. Wrapped in a Dexie rw transaction so concurrent calls (rare in
 * a single-tab app, but possible) can't hand out the same number twice.
 */
export async function assignNextInvoiceNumber(): Promise<string> {
  const db = getDB();
  let result = "";
  await db.transaction("rw", db.settings, async () => {
    const current =
      (await db.settings.get("singleton")) ?? { ...DEFAULT_SETTINGS };
    const { numberPrefix, nextNumber } = current.invoice;
    result = formatInvoiceNumber(numberPrefix, nextNumber);
    const updated: Settings = {
      ...current,
      invoice: { ...current.invoice, nextNumber: nextNumber + 1 },
    };
    await db.settings.put(updated);
  });
  return result;
}

export function invoiceTotals(items: InvoiceLineItem[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = sumLineItems(items);
  return { subtotal, total: subtotal };
}

/**
 * Flip the invoice to "sent" and mark every referenced task and expense as
 * billed with this invoice's id. Idempotent: re-running on an already-sent
 * invoice just re-asserts the same fields.
 */
export async function markInvoiceSent(invoice: Invoice): Promise<void> {
  const db = getDB();
  const taskIds = invoice.lineItems
    .filter((l) => l.sourceType === "task" && l.sourceId)
    .map((l) => l.sourceId as string);
  const expenseIds = invoice.lineItems
    .filter((l) => l.sourceType === "expense" && l.sourceId)
    .map((l) => l.sourceId as string);

  await db.transaction(
    "rw",
    db.invoices,
    db.tasks,
    db.expenses,
    async () => {
      const ts = Date.now();
      await db.invoices.update(invoice.id, {
        status: "sent",
        updatedAt: ts,
      });
      for (const tid of taskIds) {
        await db.tasks.update(tid, {
          isBilled: true,
          invoiceId: invoice.id,
          updatedAt: ts,
        });
      }
      for (const eid of expenseIds) {
        await db.expenses.update(eid, {
          isBilled: true,
          invoiceId: invoice.id,
          updatedAt: ts,
        });
      }
    },
  );
}

export async function markInvoicePaid(invoiceId: string): Promise<void> {
  const db = getDB();
  await db.invoices.update(invoiceId, {
    status: "paid",
    updatedAt: Date.now(),
  });
}
