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
  RecurringScheduleCreateInput,
  RecurringSchedule,
  RecurringStatus,
  Retainer,
  RetainerCreateInput,
  RetainerStatus,
} from "@/core/recurring";

// Re-exported so consumers can import every create-input type from the
// storage contract module.
export type {
  RecurringScheduleCreateInput,
  RetainerCreateInput,
  RecurringStatus,
  RetainerStatus,
};

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Deep-partial settings update. Nested sections merge key-by-key, so callers
 * may patch e.g. `{ invoice: { paymentTermsDays: 30 } }` without resending
 * the whole section. Both providers implement this merge semantic.
 */
export type SettingsPatch = {
  business?: Partial<Settings["business"]>;
  invoice?: Partial<Settings["invoice"]>;
  reckoning?: Partial<Settings["reckoning"]>;
  appearance?: Partial<Settings["appearance"]>;
  expenseCategories?: string[];
};

export type ClientCreateInput = Optional<
  Client,
  "id" | "archived" | "createdAt" | "updatedAt"
>;
export type ProjectCreateInput = Optional<
  Project,
  "id" | "archived" | "createdAt" | "updatedAt"
>;
export type TaskCreateInput = Optional<
  Task,
  "id" | "isBilled" | "tags" | "createdAt" | "updatedAt" | "durationMinutes"
>;
export type ExpenseCreateInput = Optional<
  Expense,
  "id" | "isBilled" | "createdAt" | "updatedAt"
>;
export type InvoiceCreateInput = Optional<
  Invoice,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * StorageProvider — the single seam between Tallyhand's domain layer and
 * persistence. Every implementation must honor these contracts:
 *
 * - `create*` assigns `id` (via `newId`), `createdAt`/`updatedAt` timestamps,
 *   and entity-specific defaults (`archived: false`, `isBilled: false`,
 *   `tags: []`) when the caller omits them. Task creation derives
 *   `durationMinutes` from `startAt`/`endAt` when omitted.
 * - `update*` always refreshes `updatedAt`. Task updates recompute
 *   `durationMinutes` when `startAt`/`endAt` change.
 * - Reads return entities ordered newest-first where the current UX depends
 *   on it (tasks by `startAt`, expenses by `date`, invoices by `issueDate`).
 * - `getSettings` is read-or-initialize: it persists and returns defaults
 *   when no settings row exists, and backfills new fields on older rows.
 *   `readSettings` is the pure read (returns `undefined` when missing) —
 *   safe to call from reactive query callbacks.
 * - `assignNextInvoiceNumber`, `markInvoiceSent`, and `markInvoicePaid` are
 *   multi-entity workflows that MUST be atomic in every implementation.
 */
export interface StorageProvider {
  /** Human-readable provider name, e.g. "dexie", "postgres". */
  readonly providerName: string;

  // -- clients -----------------------------------------------------------
  listClients(includeArchived?: boolean): Promise<Client[]>;
  getClient(id: ID): Promise<Client | undefined>;
  createClient(input: ClientCreateInput): Promise<Client>;
  updateClient(id: ID, patch: Partial<Client>): Promise<void>;
  removeClient(id: ID): Promise<void>;

  // -- projects ----------------------------------------------------------
  listProjects(): Promise<Project[]>;
  listProjectsByClient(clientId: ID): Promise<Project[]>;
  getProject(id: ID): Promise<Project | undefined>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  updateProject(id: ID, patch: Partial<Project>): Promise<void>;
  removeProject(id: ID): Promise<void>;

  // -- tasks -------------------------------------------------------------
  listTasks(): Promise<Task[]>;
  getTask(id: ID): Promise<Task | undefined>;
  listTasksByProject(projectId: ID): Promise<Task[]>;
  listUnbilledTasks(): Promise<Task[]>;
  createTask(input: TaskCreateInput): Promise<Task>;
  updateTask(id: ID, patch: Partial<Task>): Promise<void>;
  removeTask(id: ID): Promise<void>;

  // -- expenses ----------------------------------------------------------
  listExpenses(): Promise<Expense[]>;
  getExpense(id: ID): Promise<Expense | undefined>;
  createExpense(input: ExpenseCreateInput): Promise<Expense>;
  updateExpense(id: ID, patch: Partial<Expense>): Promise<void>;
  removeExpense(id: ID): Promise<void>;

  // -- invoices ----------------------------------------------------------
  listInvoices(): Promise<Invoice[]>;
  getInvoice(id: ID): Promise<Invoice | undefined>;
  getInvoiceByPublicToken(token: string): Promise<Invoice | undefined>;
  createInvoice(input: InvoiceCreateInput): Promise<Invoice>;
  updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void>;
  removeInvoice(id: ID): Promise<void>;

  // -- settings ----------------------------------------------------------
  readSettings(): Promise<Settings | undefined>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;

  // -- recurring schedules -------------------------------------------------
  /**
   * `createRecurringSchedule` defaults: `id` via `newId`, `createdAt`/
   * `updatedAt` = now, `status` = "active", `nextRunAt` = `startDate`,
   * `occurrences` = 0.
   */
  listRecurringSchedules(status?: RecurringStatus): Promise<RecurringSchedule[]>;
  listRecurringSchedulesByClient(clientId: ID): Promise<RecurringSchedule[]>;
  getRecurringSchedule(id: ID): Promise<RecurringSchedule | undefined>;
  createRecurringSchedule(
    input: RecurringScheduleCreateInput,
  ): Promise<RecurringSchedule>;
  updateRecurringSchedule(
    id: ID,
    patch: Partial<RecurringSchedule>,
  ): Promise<void>;
  removeRecurringSchedule(id: ID): Promise<void>;

  // -- retainers -----------------------------------------------------------
  /**
   * `createRetainer` defaults: `id` via `newId`, `createdAt`/`updatedAt` =
   * now, `status` = "active".
   */
  listRetainers(status?: RetainerStatus): Promise<Retainer[]>;
  listRetainersByClient(clientId: ID): Promise<Retainer[]>;
  getRetainer(id: ID): Promise<Retainer | undefined>;
  createRetainer(input: RetainerCreateInput): Promise<Retainer>;
  updateRetainer(id: ID, patch: Partial<Retainer>): Promise<void>;
  removeRetainer(id: ID): Promise<void>;

  // -- transactional domain workflows (must be atomic) -------------------
  /**
   * Format the next invoice number from settings, bump the counter, and
   * persist — atomically, so concurrent callers never receive the same number.
   */
  assignNextInvoiceNumber(): Promise<string>;
  /**
   * Flip the invoice to "sent" and mark every referenced task/expense as
   * billed with this invoice's id. Idempotent.
   */
  markInvoiceSent(invoice: Invoice): Promise<void>;
  /** Flip the invoice to "paid". */
  markInvoicePaid(invoiceId: ID): Promise<void>;
}
