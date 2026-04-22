import { getDB } from "@/lib/db/schema";
import {
  clientRepo,
  expenseRepo,
  invoiceRepo,
  projectRepo,
  settingsRepo,
  taskRepo,
} from "@/lib/db/repos";
import { normalizeSettings } from "@/lib/settings-normalize";
import type { Settings } from "@/lib/db/types";
import type { Client, Expense, Invoice, Project, Task } from "@/lib/db/types";
import {
  exportCombinedJson,
  exportExpensesCsv,
  exportMarkdownLedger,
  exportTasksCsv,
  type LedgerExportExpense,
  type LedgerExportRow,
  type LedgerExportTask,
} from "@/lib/ledger-export";

export const TALLYHAND_BUNDLE_FORMAT = "tallyhand.v1" as const;

export type TallyhandBundleV1 = {
  format: typeof TALLYHAND_BUNDLE_FORMAT;
  exportedAt: string;
  settings: Settings;
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  expenses: Expense[];
  invoices: Invoice[];
};

function buildLedgerRows(
  tasks: Task[],
  expenses: Expense[],
  clients: Client[],
  projects: Project[],
): LedgerExportRow[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const rows: LedgerExportRow[] = [];
  for (const t of tasks) {
    const p = projectById.get(t.projectId);
    const c = p ? clientById.get(p.clientId) : undefined;
    const r: LedgerExportTask = {
      kind: "task",
      task: t,
      clientName: c?.name ?? "",
      projectName: p?.name ?? "",
    };
    rows.push(r);
  }
  for (const e of expenses) {
    const p = e.projectId ? projectById.get(e.projectId) : undefined;
    const cFromP = p ? clientById.get(p.clientId) : undefined;
    const c = e.clientId ? clientById.get(e.clientId) : cFromP;
    const r: LedgerExportExpense = {
      kind: "expense",
      expense: e,
      clientName: c?.name ?? "",
      projectName: p?.name ?? "",
    };
    rows.push(r);
  }
  return rows;
}

export async function exportTallyhandBundleV1(): Promise<TallyhandBundleV1> {
  const [
    settings,
    clients,
    projects,
    tasks,
    expenses,
    invoices,
  ] = await Promise.all([
    settingsRepo.get(),
    clientRepo.list(true),
    projectRepo.list(),
    taskRepo.list(),
    expenseRepo.list(),
    invoiceRepo.list(),
  ]);
  return {
    format: TALLYHAND_BUNDLE_FORMAT,
    exportedAt: new Date().toISOString(),
    settings,
    clients,
    projects,
    tasks,
    expenses,
    invoices,
  };
}

export async function exportBundleJsonString(): Promise<string> {
  const bundle = await exportTallyhandBundleV1();
  return JSON.stringify(bundle, null, 2);
}

/** Ledger-style JSON (tasks/expenses rows + clients/projects) for parity with Stage 2. */
export async function exportLedgerJsonString(): Promise<string> {
  const [clients, projects, tasks, expenses] = await Promise.all([
    clientRepo.list(true),
    projectRepo.list(),
    taskRepo.list(),
    expenseRepo.list(),
  ]);
  const rows = buildLedgerRows(tasks, expenses, clients, projects);
  return exportCombinedJson(rows, clients, projects);
}

export async function exportBundleMarkdown(): Promise<string> {
  const [clients, projects, tasks, expenses] = await Promise.all([
    clientRepo.list(true),
    projectRepo.list(),
    taskRepo.list(),
    expenseRepo.list(),
  ]);
  const rows = buildLedgerRows(tasks, expenses, clients, projects);
  return exportMarkdownLedger(rows);
}

export async function exportBundleTasksCsv(): Promise<string> {
  const [clients, projects, tasks, expenses] = await Promise.all([
    clientRepo.list(true),
    projectRepo.list(),
    taskRepo.list(),
    expenseRepo.list(),
  ]);
  const rows = buildLedgerRows(tasks, expenses, clients, projects).filter(
    (r): r is LedgerExportTask => r.kind === "task",
  );
  return exportTasksCsv(rows);
}

export async function exportBundleExpensesCsv(): Promise<string> {
  const [clients, projects, tasks, expenses] = await Promise.all([
    clientRepo.list(true),
    projectRepo.list(),
    taskRepo.list(),
    expenseRepo.list(),
  ]);
  const rows = buildLedgerRows(tasks, expenses, clients, projects).filter(
    (r): r is LedgerExportExpense => r.kind === "expense",
  );
  return exportExpensesCsv(rows);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseTallyhandBundleV1(raw: unknown): TallyhandBundleV1 {
  if (!isRecord(raw)) throw new Error("Import file is not a JSON object.");
  if (raw.format !== TALLYHAND_BUNDLE_FORMAT) {
    throw new Error(
      `Unsupported format: expected "${TALLYHAND_BUNDLE_FORMAT}", got ${String(raw.format)}.`,
    );
  }
  if (!Array.isArray(raw.clients) || !Array.isArray(raw.projects))
    throw new Error("Bundle is missing clients or projects arrays.");
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.expenses))
    throw new Error("Bundle is missing tasks or expenses arrays.");
  if (!Array.isArray(raw.invoices)) throw new Error("Bundle is missing invoices array.");
  if (!isRecord(raw.settings)) throw new Error("Bundle is missing settings object.");
  return raw as unknown as TallyhandBundleV1;
}

export async function importTallyhandBundleV1(bundle: TallyhandBundleV1): Promise<void> {
  const db = getDB();
  const tables = [
    db.clients,
    db.projects,
    db.tasks,
    db.expenses,
    db.invoices,
    db.settings,
  ];
  await db.transaction("rw", tables, async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.tasks.clear();
    await db.expenses.clear();
    await db.invoices.clear();
    await db.settings.clear();
    if (bundle.clients.length) await db.clients.bulkAdd(bundle.clients);
    if (bundle.projects.length) await db.projects.bulkAdd(bundle.projects);
    if (bundle.tasks.length) await db.tasks.bulkAdd(bundle.tasks);
    if (bundle.expenses.length) await db.expenses.bulkAdd(bundle.expenses);
    if (bundle.invoices.length) await db.invoices.bulkAdd(bundle.invoices);
    await db.settings.put(normalizeSettings(bundle.settings));
  });
}

export async function resetAllLocalData(): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  await settingsRepo.get();
}
