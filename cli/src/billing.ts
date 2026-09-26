/**
 * Shared billing logic for the CLI and MCP server: rate resolution, unbilled
 * aggregation, and line-item construction. Mirrors the domain rules in the
 * app's src/core/invoice.ts (hours = round2(minutes/60), rate =
 * project.rateOverride ?? client.defaultRate ?? 0) without importing app code.
 */
import { round2 } from "./format.js";

/** Minimal structural API surface billing helpers need. */
export interface BillingApi {
  listTasks(p?: any): Promise<any>;
  listExpenses(p?: any): Promise<any>;
  listProjects(p?: any): Promise<any>;
  listClients(p?: any): Promise<any>;
}

export interface LineItemInput {
  description: string;
  quantity: number;
  rate: number;
  amount?: number;
  sourceType?: "task" | "expense" | "manual";
  sourceId?: string;
}

export function computeLineAmount(quantity: number, rate: number): number {
  return round2(round2(quantity) * round2(rate));
}

export function taskToLineItem(
  task: any,
  project?: any,
  client?: any,
): LineItemInput {
  const hours = round2((task.durationMinutes ?? 0) / 60);
  const rate = project?.rateOverride ?? client?.defaultRate ?? 0;
  return {
    description: task.name ?? "Time entry",
    quantity: hours,
    rate,
    amount: computeLineAmount(hours, rate),
    sourceType: "task",
    sourceId: task.id,
  };
}

export function expenseToLineItem(expense: any): LineItemInput {
  const description = expense.note
    ? `${expense.category} — ${expense.note}`
    : (expense.category ?? "Expense");
  return {
    description,
    quantity: 1,
    rate: expense.amount ?? 0,
    amount: round2(expense.amount ?? 0),
    sourceType: "expense",
    sourceId: expense.id,
  };
}

export interface UnbilledOptions {
  clientId?: string;
  projectId?: string;
}

export interface UnbilledRow {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  taskCount: number;
  expenseCount: number;
  minutes: number;
  taskAmount: number;
  expenseAmount: number;
}

/**
 * Aggregate unbilled work grouped by client/project. Open timers
 * (endAt missing/0) are excluded — they have no duration yet.
 */
export async function collectUnbilled(
  client: BillingApi,
  opts: UnbilledOptions = {},
): Promise<UnbilledRow[]> {
  const [tasks, expenses, projects, clients] = await Promise.all([
    client.listTasks({ all: true, isBilled: false }) as Promise<any[]>,
    client.listExpenses({ all: true, isBilled: false }) as Promise<any[]>,
    client.listProjects({ all: true }) as Promise<any[]>,
    client.listClients({ all: true }) as Promise<any[]>,
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const groups = new Map<string, UnbilledRow>();

  const key = (c: any, p: any) => `${c?.id ?? "?"}::${p?.id ?? "?"}`;
  const ensure = (c: any, p: any): UnbilledRow => {
    const k = key(c, p);
    let g = groups.get(k);
    if (!g) {
      g = {
        clientId: c?.id ?? "",
        clientName: c?.name ?? "(unknown client)",
        projectId: p?.id ?? "",
        projectName: p?.name ?? "(unknown project)",
        taskCount: 0,
        expenseCount: 0,
        minutes: 0,
        taskAmount: 0,
        expenseAmount: 0,
      };
      groups.set(k, g);
    }
    return g;
  };

  for (const t of tasks) {
    if (!t.endAt) continue; // open timer — not billable yet
    const p = projectById.get(t.projectId);
    const c = p ? clientById.get(p.clientId) : undefined;
    if (opts.clientId && c?.id !== opts.clientId) continue;
    if (opts.projectId && t.projectId !== opts.projectId) continue;
    const g = ensure(c, p);
    const rate = p?.rateOverride ?? c?.defaultRate ?? 0;
    g.taskCount += 1;
    g.minutes += t.durationMinutes ?? 0;
    g.taskAmount = round2(
      g.taskAmount + computeLineAmount((t.durationMinutes ?? 0) / 60, rate),
    );
  }

  for (const e of expenses) {
    const p = e.projectId ? projectById.get(e.projectId) : undefined;
    const c = e.clientId
      ? clientById.get(e.clientId)
      : p
        ? clientById.get(p.clientId)
        : undefined;
    if (opts.clientId && c?.id !== opts.clientId) continue;
    if (opts.projectId && e.projectId !== opts.projectId) continue;
    const g = ensure(c, p);
    g.expenseCount += 1;
    g.expenseAmount = round2(g.expenseAmount + (e.amount ?? 0));
  }

  return [...groups.values()].sort((a, b) =>
    a.clientName.localeCompare(b.clientName),
  );
}

/**
 * Build draft-invoice line items from unbilled work for a client
 * (optionally scoped to a project). Returns the items plus the source
 * tasks/expenses they were built from.
 */
export async function buildUnbilledLineItems(
  client: BillingApi,
  opts: { clientId: string; projectId?: string },
): Promise<{ lineItems: LineItemInput[]; taskCount: number; expenseCount: number }> {
  const [tasks, expenses, projects, clients] = await Promise.all([
    client.listTasks({ all: true, isBilled: false }) as Promise<any[]>,
    client.listExpenses({ all: true, isBilled: false }) as Promise<any[]>,
    client.listProjects({ all: true }) as Promise<any[]>,
    client.listClients({ all: true }) as Promise<any[]>,
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const lineItems: LineItemInput[] = [];
  let taskCount = 0;
  let expenseCount = 0;

  for (const t of tasks) {
    if (!t.endAt) continue;
    const p = projectById.get(t.projectId);
    const c = p ? clientById.get(p.clientId) : undefined;
    if (c?.id !== opts.clientId) continue;
    if (opts.projectId && t.projectId !== opts.projectId) continue;
    lineItems.push(taskToLineItem(t, p, c));
    taskCount += 1;
  }
  for (const e of expenses) {
    const p = e.projectId ? projectById.get(e.projectId) : undefined;
    const c = e.clientId
      ? clientById.get(e.clientId)
      : p
        ? clientById.get(p.clientId)
        : undefined;
    if (c?.id !== opts.clientId) continue;
    if (opts.projectId && e.projectId !== opts.projectId) continue;
    lineItems.push(expenseToLineItem(e));
    expenseCount += 1;
  }
  return { lineItems, taskCount, expenseCount };
}

/** Sum line items -> { subtotal, total } (no tax/discount model yet). */
export function invoiceTotals(lineItems: LineItemInput[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = round2(
    lineItems.reduce((s, li) => s + (li.amount ?? computeLineAmount(li.quantity, li.rate)), 0),
  );
  return { subtotal, total: subtotal };
}
