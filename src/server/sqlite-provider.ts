/**
 * SERVER ONLY — never import from client components.
 *
 * SqliteStorageProvider implements the StorageProvider interface
 * (src/core/storage.ts) on top of node:sqlite (Node 22+ built-in, zero new
 * dependencies). This is the server-side provider used by the REST API v1
 * routes, the `tally` CLI, and the MCP server: it lets agents drive
 * Tallyhand over HTTP without a browser.
 *
 * Storage layout: every table has explicit scalar columns (TEXT ids, INTEGER
 * millisecond timestamps, REAL amounts, INTEGER 0/1 booleans) for the fields
 * we filter/order/index on, plus a `data` TEXT column holding the full entity
 * JSON. Reads return the parsed JSON (lossless); scalars keep queries fast
 * and indexable.
 *
 * Semantics intentionally mirror DexieStorageProvider
 * (src/lib/db/dexie-provider.ts): create* defaults, update* updatedAt
 * refresh + durationMinutes recompute, list orderings, read-or-initialize
 * settings, and the atomic invoice workflows.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { newId, now } from "@/core/id";
import { normalizeSettings } from "@/core/settings";
import { DEFAULT_SETTINGS } from "@/core/entities";
import { formatInvoiceNumber } from "@/core/invoice";
import type {
  Client,
  Expense,
  ID,
  Invoice,
  Project,
  Settings,
  Task,
} from "@/core/entities";
import type {
  ClientCreateInput,
  ExpenseCreateInput,
  InvoiceCreateInput,
  ProjectCreateInput,
  StorageProvider,
  SettingsPatch,
  TaskCreateInput,
} from "@/core/storage";
import type {
  RecurringSchedule,
  RecurringScheduleCreateInput,
  RecurringStatus,
  Retainer,
  RetainerCreateInput,
  RetainerStatus,
} from "@/core/recurring";
import type { MileageEntry, MileageEntryCreateInput } from "@/core/mileage";
import { mileageRateForDate } from "@/core/mileage";
import type { Contract, ContractCreateInput } from "@/core/contracts";
import type { TaxPayment, TaxPaymentCreateInput } from "@/core/tax";
import type { RateCard, RateCardCreateInput } from "@/core/rate-cards";

/** Resolve the SQLite file path. Exported for idempotency.ts and tests. */
export function resolveDbPath(): string {
  const fromEnv = process.env.TALLYHAND_DB_PATH;
  const dbPath =
    fromEnv && fromEnv.length > 0
      ? fromEnv
      : join(homedir(), ".tallyhand", "tallyhand.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}

/** Temp DB path helper for tests. */
export function tempDbPath(prefix = "tallyhand-test"): string {
  return join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}.db`);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  is_billed INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  project_id TEXT,
  date INTEGER NOT NULL,
  category TEXT NOT NULL,
  is_billed INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL,
  issue_date INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  public_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  status TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retainers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mileage_entries (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  project_id TEXT,
  date INTEGER NOT NULL,
  is_billed INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT NOT NULL,
  end_date INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tax_payments (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL,
  date INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_cards (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  effective_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_billed ON tasks (is_billed);
CREATE INDEX IF NOT EXISTS idx_expenses_client ON expenses (client_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses (project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_billed ON expenses (is_billed);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_schedules_client ON recurring_schedules (client_id);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON recurring_schedules (status);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON recurring_schedules (next_run_at);
CREATE INDEX IF NOT EXISTS idx_retainers_client ON retainers (client_id);
CREATE INDEX IF NOT EXISTS idx_retainers_status ON retainers (status);
CREATE INDEX IF NOT EXISTS idx_mileage_client ON mileage_entries (client_id);
CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage_entries (date);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_end ON contracts (end_date);
CREATE INDEX IF NOT EXISTS idx_taxpay_year ON tax_payments (tax_year);
CREATE INDEX IF NOT EXISTS idx_ratecards_client ON rate_cards (client_id);
`;

type SqliteValue = string | number | null;

interface Row {
  data: string;
}

export class SqliteStorageProvider implements StorageProvider {
  readonly providerName = "sqlite";
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const path = dbPath ?? resolveDbPath();
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  /** Close the underlying database handle (mainly for tests). */
  close(): void {
    this.db.close();
  }

  // -- low-level helpers -------------------------------------------------
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      throw err;
    }
  }

  private getRow(table: string, id: string): Row | undefined {
    return this.db
      .prepare(`SELECT data FROM ${table} WHERE id = ?`)
      .get(id) as Row | undefined;
  }

  private parse<T>(row: Row | undefined): T | undefined {
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  private allRows(table: string, where = "", params: SqliteValue[] = []): Row[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ${where}`)
      .all(...params) as Row[];
  }

  private insert(table: string, columns: string[], values: SqliteValue[]): void {
    const placeholders = columns.map(() => "?").join(", ");
    this.db
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
      .run(...values);
  }

  // -- clients -----------------------------------------------------------
  async listClients(includeArchived = false): Promise<Client[]> {
    const rows = this.allRows(
      "clients",
      includeArchived ? "ORDER BY name ASC" : "WHERE archived = 0 ORDER BY name ASC",
    );
    return rows.map((r) => JSON.parse(r.data) as Client);
  }

  async getClient(id: ID): Promise<Client | undefined> {
    return this.parse<Client>(this.getRow("clients", id));
  }

  async createClient(input: ClientCreateInput): Promise<Client> {
    const ts = now();
    const client = {
      id: input.id ?? newId("cli"),
      archived: input.archived ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Client;
    this.insert(
      "clients",
      ["id", "name", "archived", "created_at", "updated_at", "data"],
      [client.id, client.name, client.archived ? 1 : 0, client.createdAt, client.updatedAt, JSON.stringify(client)],
    );
    return client;
  }

  async updateClient(id: ID, patch: Partial<Client>): Promise<void> {
    const existing = await this.getClient(id);
    if (!existing) return; // mirror Dexie: no-op on missing id
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Client = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE clients SET name = ?, archived = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.name, next.archived ? 1 : 0, next.updatedAt, JSON.stringify(next), id);
  }

  async removeClient(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM clients WHERE id = ?").run(id);
  }

  // -- projects ----------------------------------------------------------
  async listProjects(): Promise<Project[]> {
    return this.allRows("projects", "ORDER BY rowid ASC").map(
      (r) => JSON.parse(r.data) as Project,
    );
  }

  async listProjectsByClient(clientId: ID): Promise<Project[]> {
    return this.allRows("projects", "WHERE client_id = ? ORDER BY rowid ASC", [clientId]).map(
      (r) => JSON.parse(r.data) as Project,
    );
  }

  async getProject(id: ID): Promise<Project | undefined> {
    return this.parse<Project>(this.getRow("projects", id));
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    const ts = now();
    const project = {
      id: input.id ?? newId("prj"),
      archived: input.archived ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Project;
    this.insert(
      "projects",
      ["id", "client_id", "name", "archived", "created_at", "updated_at", "data"],
      [project.id, project.clientId, project.name, project.archived ? 1 : 0, project.createdAt, project.updatedAt, JSON.stringify(project)],
    );
    return project;
  }

  async updateProject(id: ID, patch: Partial<Project>): Promise<void> {
    const existing = await this.getProject(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Project = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE projects SET client_id = ?, name = ?, archived = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.name, next.archived ? 1 : 0, next.updatedAt, JSON.stringify(next), id);
  }

  async removeProject(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  // -- tasks -------------------------------------------------------------
  async listTasks(): Promise<Task[]> {
    return this.allRows("tasks", "ORDER BY start_at DESC").map(
      (r) => JSON.parse(r.data) as Task,
    );
  }

  async getTask(id: ID): Promise<Task | undefined> {
    return this.parse<Task>(this.getRow("tasks", id));
  }

  async listTasksByProject(projectId: ID): Promise<Task[]> {
    return this.allRows("tasks", "WHERE project_id = ? ORDER BY start_at DESC", [projectId]).map(
      (r) => JSON.parse(r.data) as Task,
    );
  }

  async listUnbilledTasks(): Promise<Task[]> {
    return this.allRows("tasks", "WHERE is_billed = 0 ORDER BY start_at DESC").map(
      (r) => JSON.parse(r.data) as Task,
    );
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const ts = now();
    const durationMinutes =
      input.durationMinutes ??
      Math.max(0, Math.round((input.endAt - input.startAt) / 60000));
    const task = {
      id: input.id ?? newId("tsk"),
      isBilled: input.isBilled ?? false,
      tags: input.tags ?? [],
      durationMinutes,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Task;
    this.insert(
      "tasks",
      ["id", "project_id", "start_at", "end_at", "is_billed", "invoice_id", "created_at", "updated_at", "data"],
      [task.id, task.projectId, task.startAt, task.endAt ?? null, task.isBilled ? 1 : 0, task.invoiceId ?? null, task.createdAt, task.updatedAt, JSON.stringify(task)],
    );
    return task;
  }

  async updateTask(id: ID, patch: Partial<Task>): Promise<void> {
    const existing = await this.getTask(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Partial<Task> = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    if (patch.startAt != null || patch.endAt != null) {
      const startAt = patch.startAt ?? existing.startAt;
      const endAt = patch.endAt ?? existing.endAt;
      next.durationMinutes = Math.max(0, Math.round((endAt - startAt) / 60000));
    }
    const merged = next as Task;
    this.db
      .prepare("UPDATE tasks SET project_id = ?, start_at = ?, end_at = ?, is_billed = ?, invoice_id = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(merged.projectId, merged.startAt, merged.endAt ?? null, merged.isBilled ? 1 : 0, merged.invoiceId ?? null, merged.updatedAt, JSON.stringify(merged), id);
  }

  async removeTask(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  // -- expenses ----------------------------------------------------------
  async listExpenses(): Promise<Expense[]> {
    return this.allRows("expenses", "ORDER BY date DESC").map(
      (r) => JSON.parse(r.data) as Expense,
    );
  }

  async getExpense(id: ID): Promise<Expense | undefined> {
    return this.parse<Expense>(this.getRow("expenses", id));
  }

  async createExpense(input: ExpenseCreateInput): Promise<Expense> {
    const ts = now();
    const expense = {
      id: input.id ?? newId("exp"),
      isBilled: input.isBilled ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Expense;
    this.insert(
      "expenses",
      ["id", "client_id", "project_id", "date", "category", "is_billed", "invoice_id", "created_at", "updated_at", "data"],
      [expense.id, expense.clientId ?? null, expense.projectId ?? null, expense.date, expense.category, expense.isBilled ? 1 : 0, expense.invoiceId ?? null, expense.createdAt, expense.updatedAt, JSON.stringify(expense)],
    );
    return expense;
  }

  async updateExpense(id: ID, patch: Partial<Expense>): Promise<void> {
    const existing = await this.getExpense(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Expense = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE expenses SET client_id = ?, project_id = ?, date = ?, category = ?, is_billed = ?, invoice_id = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId ?? null, next.projectId ?? null, next.date, next.category, next.isBilled ? 1 : 0, next.invoiceId ?? null, next.updatedAt, JSON.stringify(next), id);
  }

  async removeExpense(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  }

  // -- invoices ----------------------------------------------------------
  async listInvoices(): Promise<Invoice[]> {
    return this.allRows("invoices", "ORDER BY issue_date DESC").map(
      (r) => JSON.parse(r.data) as Invoice,
    );
  }

  async getInvoice(id: ID): Promise<Invoice | undefined> {
    return this.parse<Invoice>(this.getRow("invoices", id));
  }

  async getInvoiceByPublicToken(token: string): Promise<Invoice | undefined> {
    if (!token) return undefined;
    const rows = this.allRows("invoices", "WHERE public_token = ? LIMIT 1", [token]);
    return this.parse<Invoice>(rows[0]);
  }

  async createInvoice(input: InvoiceCreateInput): Promise<Invoice> {
    const ts = now();
    const invoice = {
      id: input.id ?? newId("inv"),
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Invoice;
    this.insert(
      "invoices",
      ["id", "client_id", "invoice_number", "status", "issue_date", "due_date", "public_token", "created_at", "updated_at", "data"],
      [invoice.id, invoice.clientId, invoice.invoiceNumber, invoice.status, invoice.issueDate, invoice.dueDate, invoice.publicToken ?? null, invoice.createdAt, invoice.updatedAt, JSON.stringify(invoice)],
    );
    return invoice;
  }

  async updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
    const existing = await this.getInvoice(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Invoice = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE invoices SET client_id = ?, invoice_number = ?, status = ?, issue_date = ?, due_date = ?, public_token = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.invoiceNumber, next.status, next.issueDate, next.dueDate, next.publicToken ?? null, next.updatedAt, JSON.stringify(next), id);
  }

  async removeInvoice(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM invoices WHERE id = ?").run(id);
  }

  // -- recurring schedules -----------------------------------------------
  async listRecurringSchedules(status?: RecurringStatus): Promise<RecurringSchedule[]> {
    const where = status ? "WHERE status = ? ORDER BY next_run_at ASC" : "ORDER BY next_run_at ASC";
    const params: SqliteValue[] = status ? [status] : [];
    return this.allRows("recurring_schedules", where, params).map(
      (r) => JSON.parse(r.data) as RecurringSchedule,
    );
  }

  async listRecurringSchedulesByClient(clientId: string): Promise<RecurringSchedule[]> {
    return this.allRows("recurring_schedules", "WHERE client_id = ? ORDER BY next_run_at ASC", [clientId]).map(
      (r) => JSON.parse(r.data) as RecurringSchedule,
    );
  }

  async getRecurringSchedule(id: string): Promise<RecurringSchedule | undefined> {
    return this.parse<RecurringSchedule>(this.getRow("recurring_schedules", id));
  }

  async createRecurringSchedule(input: RecurringScheduleCreateInput): Promise<RecurringSchedule> {
    const ts = now();
    const schedule: RecurringSchedule = {
      ...input,
      id: input.id ?? newId("rsd"),
      status: input.status ?? "active",
      // Mirror writes adopt the browser's run cursor wholesale.
      nextRunAt: input.nextRunAt ?? input.startDate,
      ...(input.lastRunAt != null ? { lastRunAt: input.lastRunAt } : {}),
      occurrences: input.occurrences ?? 0,
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    };
    this.insert(
      "recurring_schedules",
      ["id", "client_id", "project_id", "status", "next_run_at", "created_at", "updated_at", "data"],
      [schedule.id, schedule.clientId, schedule.projectId ?? null, schedule.status, schedule.nextRunAt, schedule.createdAt, schedule.updatedAt, JSON.stringify(schedule)],
    );
    return schedule;
  }

  async updateRecurringSchedule(id: string, patch: Partial<RecurringSchedule>): Promise<void> {
    const existing = await this.getRecurringSchedule(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: RecurringSchedule = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE recurring_schedules SET client_id = ?, project_id = ?, status = ?, next_run_at = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.projectId ?? null, next.status, next.nextRunAt, next.updatedAt, JSON.stringify(next), id);
  }

  async removeRecurringSchedule(id: string): Promise<void> {
    this.db.prepare("DELETE FROM recurring_schedules WHERE id = ?").run(id);
  }

  // -- retainers ---------------------------------------------------------
  async listRetainers(status?: RetainerStatus): Promise<Retainer[]> {
    const where = status ? "WHERE status = ? ORDER BY created_at DESC" : "ORDER BY created_at DESC";
    const params: SqliteValue[] = status ? [status] : [];
    return this.allRows("retainers", where, params).map(
      (r) => JSON.parse(r.data) as Retainer,
    );
  }

  async listRetainersByClient(clientId: string): Promise<Retainer[]> {
    return this.allRows("retainers", "WHERE client_id = ? ORDER BY created_at DESC", [clientId]).map(
      (r) => JSON.parse(r.data) as Retainer,
    );
  }

  async getRetainer(id: string): Promise<Retainer | undefined> {
    return this.parse<Retainer>(this.getRow("retainers", id));
  }

  async createRetainer(input: RetainerCreateInput): Promise<Retainer> {
    const ts = now();
    const retainer: Retainer = {
      ...input,
      id: input.id ?? newId("rtn"),
      status: input.status ?? "active",
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    };
    this.insert(
      "retainers",
      ["id", "client_id", "status", "created_at", "updated_at", "data"],
      [retainer.id, retainer.clientId, retainer.status, retainer.createdAt, retainer.updatedAt, JSON.stringify(retainer)],
    );
    return retainer;
  }

  async updateRetainer(id: string, patch: Partial<Retainer>): Promise<void> {
    const existing = await this.getRetainer(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Retainer = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE retainers SET client_id = ?, status = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.status, next.updatedAt, JSON.stringify(next), id);
  }

  async removeRetainer(id: string): Promise<void> {
    this.db.prepare("DELETE FROM retainers WHERE id = ?").run(id);
  }

  // -- mileage -----------------------------------------------------------
  async listMileageEntries(): Promise<MileageEntry[]> {
    return this.allRows("mileage_entries", "ORDER BY date DESC").map(
      (r) => JSON.parse(r.data) as MileageEntry,
    );
  }

  async getMileageEntry(id: ID): Promise<MileageEntry | undefined> {
    return this.parse<MileageEntry>(this.getRow("mileage_entries", id));
  }

  async createMileageEntry(
    input: MileageEntryCreateInput,
  ): Promise<MileageEntry> {
    const ts = now();
    const entry = {
      id: input.id ?? newId("mil"),
      isBilled: input.isBilled ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
      // Computed after the spread: an explicit `rate: undefined` in
      // unchecked runtime input must not clobber the default.
      rate:
        (input as { rate?: number }).rate ?? mileageRateForDate(input.date),
    } as MileageEntry;
    this.insert(
      "mileage_entries",
      ["id", "client_id", "project_id", "date", "is_billed", "invoice_id", "created_at", "updated_at", "data"],
      [entry.id, entry.clientId ?? null, entry.projectId ?? null, entry.date, entry.isBilled ? 1 : 0, entry.invoiceId ?? null, entry.createdAt, entry.updatedAt, JSON.stringify(entry)],
    );
    return entry;
  }

  async updateMileageEntry(id: ID, patch: Partial<MileageEntry>): Promise<void> {
    const existing = await this.getMileageEntry(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: MileageEntry = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE mileage_entries SET client_id = ?, project_id = ?, date = ?, is_billed = ?, invoice_id = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId ?? null, next.projectId ?? null, next.date, next.isBilled ? 1 : 0, next.invoiceId ?? null, next.updatedAt, JSON.stringify(next), id);
  }

  async removeMileageEntry(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM mileage_entries WHERE id = ?").run(id);
  }

  // -- contracts ---------------------------------------------------------
  async listContracts(): Promise<Contract[]> {
    return this.allRows("contracts", "ORDER BY updated_at DESC").map(
      (r) => JSON.parse(r.data) as Contract,
    );
  }

  async getContract(id: ID): Promise<Contract | undefined> {
    return this.parse<Contract>(this.getRow("contracts", id));
  }

  async createContract(input: ContractCreateInput): Promise<Contract> {
    const ts = now();
    const contract = {
      id: input.id ?? newId("ctr"),
      renewalNoticeDays: 30,
      archived: input.archived ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as Contract;
    this.insert(
      "contracts",
      ["id", "client_id", "project_id", "type", "end_date", "archived", "created_at", "updated_at", "data"],
      [contract.id, contract.clientId, contract.projectId ?? null, contract.type, contract.endDate ?? null, contract.archived ? 1 : 0, contract.createdAt, contract.updatedAt, JSON.stringify(contract)],
    );
    return contract;
  }

  async updateContract(id: ID, patch: Partial<Contract>): Promise<void> {
    const existing = await this.getContract(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: Contract = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE contracts SET client_id = ?, project_id = ?, type = ?, end_date = ?, archived = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.projectId ?? null, next.type, next.endDate ?? null, next.archived ? 1 : 0, next.updatedAt, JSON.stringify(next), id);
  }

  async removeContract(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  }

  // -- tax payments ------------------------------------------------------
  async listTaxPayments(): Promise<TaxPayment[]> {
    return this.allRows("tax_payments", "ORDER BY date DESC").map(
      (r) => JSON.parse(r.data) as TaxPayment,
    );
  }

  async getTaxPayment(id: ID): Promise<TaxPayment | undefined> {
    return this.parse<TaxPayment>(this.getRow("tax_payments", id));
  }

  async createTaxPayment(input: TaxPaymentCreateInput): Promise<TaxPayment> {
    const ts = now();
    const payment = {
      id: input.id ?? newId("txp"),
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as TaxPayment;
    this.insert(
      "tax_payments",
      ["id", "tax_year", "quarter", "jurisdiction", "date", "created_at", "updated_at", "data"],
      [payment.id, payment.taxYear, payment.quarter, payment.jurisdiction, payment.date, payment.createdAt, payment.updatedAt, JSON.stringify(payment)],
    );
    return payment;
  }

  async updateTaxPayment(id: ID, patch: Partial<TaxPayment>): Promise<void> {
    const existing = await this.getTaxPayment(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: TaxPayment = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE tax_payments SET tax_year = ?, quarter = ?, jurisdiction = ?, date = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.taxYear, next.quarter, next.jurisdiction, next.date, next.updatedAt, JSON.stringify(next), id);
  }

  async removeTaxPayment(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM tax_payments WHERE id = ?").run(id);
  }

  // -- rate cards --------------------------------------------------------
  async listRateCards(): Promise<RateCard[]> {
    return this.allRows("rate_cards", "ORDER BY updated_at DESC").map(
      (r) => JSON.parse(r.data) as RateCard,
    );
  }

  async getRateCard(id: ID): Promise<RateCard | undefined> {
    return this.parse<RateCard>(this.getRow("rate_cards", id));
  }

  async createRateCard(input: RateCardCreateInput): Promise<RateCard> {
    const ts = now();
    const card = {
      id: input.id ?? newId("rc"),
      archived: input.archived ?? false,
      ...input,
      // Mirror writes may carry the browser's timestamps (LWW by updatedAt).
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    } as RateCard;
    this.insert(
      "rate_cards",
      ["id", "client_id", "project_id", "archived", "effective_from", "created_at", "updated_at", "data"],
      [card.id, card.clientId, card.projectId ?? null, card.archived ? 1 : 0, card.effectiveFrom, card.createdAt, card.updatedAt, JSON.stringify(card)],
    );
    return card;
  }

  async updateRateCard(id: ID, patch: Partial<RateCard>): Promise<void> {
    const existing = await this.getRateCard(id);
    if (!existing) return;
    // createdAt is immutable; mirror PATCHes may still send it — never rewrite.
    const next: RateCard = {
      ...existing,
      ...patch,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now(),
    };
    this.db
      .prepare("UPDATE rate_cards SET client_id = ?, project_id = ?, archived = ?, effective_from = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(next.clientId, next.projectId ?? null, next.archived ? 1 : 0, next.effectiveFrom, next.updatedAt, JSON.stringify(next), id);
  }

  async removeRateCard(id: ID): Promise<void> {
    this.db.prepare("DELETE FROM rate_cards WHERE id = ?").run(id);
  }

  // -- settings ----------------------------------------------------------
  async readSettings(): Promise<Settings | undefined> {
    return this.parse<Settings>(this.getRow("settings", "singleton"));
  }

  async getSettings(): Promise<Settings> {
    const existing = this.parse<Settings>(this.getRow("settings", "singleton"));
    if (existing) {
      const merged = normalizeSettings(existing);
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        this.db
          .prepare("INSERT OR REPLACE INTO settings (id, data) VALUES (?, ?)")
          .run("singleton", JSON.stringify(merged));
      }
      return merged;
    }
    this.db
      .prepare("INSERT OR REPLACE INTO settings (id, data) VALUES (?, ?)")
      .run("singleton", JSON.stringify(DEFAULT_SETTINGS));
    return DEFAULT_SETTINGS;
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const current = await this.getSettings();
    const next = normalizeSettings({
      ...current,
      ...patch,
      id: "singleton",
      business: { ...current.business, ...patch.business },
      invoice: { ...current.invoice, ...patch.invoice },
      reckoning: {
        ...current.reckoning,
        ...(patch.reckoning ?? {}),
      },
      appearance: {
        ...current.appearance,
        ...(patch.appearance ?? {}),
      },
      expenseCategories: patch.expenseCategories ?? current.expenseCategories,
      dunning: {
        ...current.dunning,
        ...(patch.dunning ?? {}),
        lateFee: {
          ...current.dunning.lateFee,
          ...(patch.dunning?.lateFee ?? {}),
        },
      },
      tax: { ...current.tax, ...(patch.tax ?? {}) },
      analytics: { ...current.analytics, ...(patch.analytics ?? {}) },
      pluginSettings: patch.pluginSettings ?? current.pluginSettings,
    });
    this.db
      .prepare("INSERT OR REPLACE INTO settings (id, data) VALUES (?, ?)")
      .run("singleton", JSON.stringify(next));
    return next;
  }

  // -- transactional domain workflows (atomic) ---------------------------
  async assignNextInvoiceNumber(): Promise<string> {
    return this.transaction(() => {
      const existing = this.parse<Settings>(this.getRow("settings", "singleton"));
      const current: Settings = existing ?? { ...DEFAULT_SETTINGS };
      const { numberPrefix, nextNumber } = current.invoice;
      const result = formatInvoiceNumber(numberPrefix, nextNumber);
      const updated: Settings = {
        ...current,
        invoice: { ...current.invoice, nextNumber: nextNumber + 1 },
      };
      this.db
        .prepare("INSERT OR REPLACE INTO settings (id, data) VALUES (?, ?)")
        .run("singleton", JSON.stringify(updated));
      return result;
    });
  }

  async markInvoiceSent(invoice: Invoice): Promise<void> {
    const taskIds = invoice.lineItems
      .filter((l) => l.sourceType === "task" && l.sourceId)
      .map((l) => l.sourceId as string);
    const expenseIds = invoice.lineItems
      .filter((l) => l.sourceType === "expense" && l.sourceId)
      .map((l) => l.sourceId as string);

    this.transaction(() => {
      const ts = Date.now();
      const stored = this.parse<Invoice>(this.getRow("invoices", invoice.id));
      if (stored) {
        const next: Invoice = { ...stored, status: "sent", updatedAt: ts };
        this.db
          .prepare("UPDATE invoices SET status = ?, updated_at = ?, data = ? WHERE id = ?")
          .run("sent", ts, JSON.stringify(next), invoice.id);
      }
      for (const tid of taskIds) {
        const task = this.parse<Task>(this.getRow("tasks", tid));
        if (task) {
          const next: Task = { ...task, isBilled: true, invoiceId: invoice.id, updatedAt: ts };
          this.db
            .prepare("UPDATE tasks SET is_billed = 1, invoice_id = ?, updated_at = ?, data = ? WHERE id = ?")
            .run(invoice.id, ts, JSON.stringify(next), tid);
        }
      }
      for (const eid of expenseIds) {
        const expense = this.parse<Expense>(this.getRow("expenses", eid));
        if (expense) {
          const next: Expense = { ...expense, isBilled: true, invoiceId: invoice.id, updatedAt: ts };
          this.db
            .prepare("UPDATE expenses SET is_billed = 1, invoice_id = ?, updated_at = ?, data = ? WHERE id = ?")
            .run(invoice.id, ts, JSON.stringify(next), eid);
        }
      }
    });
  }

  async markInvoicePaid(invoiceId: ID): Promise<void> {
    const stored = await this.getInvoice(invoiceId);
    if (!stored) return; // mirror Dexie: no-op on missing id
    const ts = Date.now();
    const next: Invoice = { ...stored, status: "paid", updatedAt: ts };
    this.db
      .prepare("UPDATE invoices SET status = ?, updated_at = ?, data = ? WHERE id = ?")
      .run("paid", ts, JSON.stringify(next), invoiceId);
  }
}

/** Test factory: build a provider against an explicit DB file. */
export function makeSqliteProvider(dbPath?: string): SqliteStorageProvider {
  // Server default: the persistent local database (TALLYHAND_DB_PATH or
  // ~/.tallyhand/tallyhand.db). Tests pass an explicit temp path.
  return new SqliteStorageProvider(dbPath ?? resolveDbPath());
}