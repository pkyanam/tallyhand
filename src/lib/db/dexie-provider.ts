import { getDB } from "./schema";
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
import type {
  ClientCreateInput,
  ExpenseCreateInput,
  InvoiceCreateInput,
  ProjectCreateInput,
  StorageProvider,
  SettingsPatch,
  TaskCreateInput,
} from "@/core/storage";

/**
 * DexieStorageProvider — the default StorageProvider, backed by IndexedDB
 * via Dexie. This is the browser-local implementation; it is the only
 * provider today. Future providers (sync server, hosted Postgres) implement
 * the same interface.
 *
 * All methods are client-only: `getDB()` throws when called server-side.
 */
export class DexieStorageProvider implements StorageProvider {
  readonly providerName = "dexie";

  // -- clients -----------------------------------------------------------
  async listClients(includeArchived = false): Promise<Client[]> {
    const all = await getDB().clients.orderBy("name").toArray();
    return includeArchived ? all : all.filter((c) => !c.archived);
  }

  async getClient(id: ID): Promise<Client | undefined> {
    return getDB().clients.get(id);
  }

  async createClient(input: ClientCreateInput): Promise<Client> {
    const ts = now();
    const client: Client = {
      id: input.id ?? newId("cli"),
      archived: input.archived ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Client;
    await getDB().clients.add(client);
    return client;
  }

  async updateClient(id: ID, patch: Partial<Client>): Promise<void> {
    await getDB().clients.update(id, { ...patch, updatedAt: now() });
  }

  async removeClient(id: ID): Promise<void> {
    await getDB().clients.delete(id);
  }

  // -- projects ----------------------------------------------------------
  async listProjectsByClient(clientId: ID): Promise<Project[]> {
    return getDB().projects.where("clientId").equals(clientId).toArray();
  }

  async listProjects(): Promise<Project[]> {
    return getDB().projects.toArray();
  }

  async getProject(id: ID): Promise<Project | undefined> {
    return getDB().projects.get(id);
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    const ts = now();
    const project: Project = {
      id: input.id ?? newId("prj"),
      archived: input.archived ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Project;
    await getDB().projects.add(project);
    return project;
  }

  async updateProject(id: ID, patch: Partial<Project>): Promise<void> {
    await getDB().projects.update(id, { ...patch, updatedAt: now() });
  }

  async removeProject(id: ID): Promise<void> {
    await getDB().projects.delete(id);
  }

  // -- tasks -------------------------------------------------------------
  async listTasks(): Promise<Task[]> {
    return getDB().tasks.orderBy("startAt").reverse().toArray();
  }

  async getTask(id: ID): Promise<Task | undefined> {
    return getDB().tasks.get(id);
  }

  async listTasksByProject(projectId: ID): Promise<Task[]> {
    return getDB().tasks.where("projectId").equals(projectId).toArray();
  }

  async listUnbilledTasks(): Promise<Task[]> {
    return getDB().tasks.filter((t) => !t.isBilled).toArray();
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const ts = now();
    const durationMinutes =
      input.durationMinutes ??
      Math.max(0, Math.round((input.endAt - input.startAt) / 60000));
    const task: Task = {
      id: input.id ?? newId("tsk"),
      isBilled: input.isBilled ?? false,
      tags: input.tags ?? [],
      durationMinutes,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Task;
    await getDB().tasks.add(task);
    return task;
  }

  async updateTask(id: ID, patch: Partial<Task>): Promise<void> {
    const next: Partial<Task> = { ...patch, updatedAt: now() };
    if (patch.startAt != null || patch.endAt != null) {
      const existing = await getDB().tasks.get(id);
      if (existing) {
        const startAt = patch.startAt ?? existing.startAt;
        const endAt = patch.endAt ?? existing.endAt;
        next.durationMinutes = Math.max(
          0,
          Math.round((endAt - startAt) / 60000),
        );
      }
    }
    await getDB().tasks.update(id, next);
  }

  async removeTask(id: ID): Promise<void> {
    await getDB().tasks.delete(id);
  }

  // -- expenses ----------------------------------------------------------
  async listExpenses(): Promise<Expense[]> {
    return getDB().expenses.orderBy("date").reverse().toArray();
  }

  async getExpense(id: ID): Promise<Expense | undefined> {
    return getDB().expenses.get(id);
  }

  async createExpense(input: ExpenseCreateInput): Promise<Expense> {
    const ts = now();
    const expense: Expense = {
      id: input.id ?? newId("exp"),
      isBilled: input.isBilled ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Expense;
    await getDB().expenses.add(expense);
    return expense;
  }

  async updateExpense(id: ID, patch: Partial<Expense>): Promise<void> {
    await getDB().expenses.update(id, { ...patch, updatedAt: now() });
  }

  async removeExpense(id: ID): Promise<void> {
    await getDB().expenses.delete(id);
  }

  // -- invoices ----------------------------------------------------------
  async listInvoices(): Promise<Invoice[]> {
    return getDB().invoices.orderBy("issueDate").reverse().toArray();
  }

  async getInvoice(id: ID): Promise<Invoice | undefined> {
    return getDB().invoices.get(id);
  }

  async getInvoiceByPublicToken(token: string): Promise<Invoice | undefined> {
    if (!token) return undefined;
    return getDB().invoices.where("publicToken").equals(token).first();
  }

  async createInvoice(input: InvoiceCreateInput): Promise<Invoice> {
    const ts = now();
    const invoice: Invoice = {
      id: input.id ?? newId("inv"),
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Invoice;
    await getDB().invoices.add(invoice);
    return invoice;
  }

  async updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
    await getDB().invoices.update(id, { ...patch, updatedAt: now() });
  }

  async removeInvoice(id: ID): Promise<void> {
    await getDB().invoices.delete(id);
  }

  // -- settings ----------------------------------------------------------
  async readSettings(): Promise<Settings | undefined> {
    return getDB().settings.get("singleton");
  }

  async getSettings(): Promise<Settings> {
    const existing = await getDB().settings.get("singleton");
    if (existing) {
      const merged = normalizeSettings(existing);
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        await getDB().settings.put(merged);
      }
      return merged;
    }
    await getDB().settings.put(DEFAULT_SETTINGS);
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
    await getDB().settings.put(next);
    return next;
  }

  // -- recurring schedules ------------------------------------------------
  async listRecurringSchedules(
    status?: RecurringStatus,
  ): Promise<RecurringSchedule[]> {
    const db = getDB();
    const rows = status
      ? await db.recurringSchedules.where("status").equals(status).toArray()
      : await db.recurringSchedules.toArray();
    return rows.sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  async listRecurringSchedulesByClient(
    clientId: ID,
  ): Promise<RecurringSchedule[]> {
    const rows = await getDB()
      .recurringSchedules.where("clientId")
      .equals(clientId)
      .toArray();
    return rows.sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  async getRecurringSchedule(id: ID): Promise<RecurringSchedule | undefined> {
    return getDB().recurringSchedules.get(id);
  }

  async createRecurringSchedule(
    input: RecurringScheduleCreateInput,
  ): Promise<RecurringSchedule> {
    const ts = now();
    const schedule: RecurringSchedule = {
      id: newId("rsd"),
      status: input.status ?? "active",
      nextRunAt: input.startDate,
      occurrences: 0,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    };
    await getDB().recurringSchedules.add(schedule);
    return schedule;
  }

  async updateRecurringSchedule(
    id: ID,
    patch: Partial<RecurringSchedule>,
  ): Promise<void> {
    await getDB().recurringSchedules.update(id, { ...patch, updatedAt: now() });
  }

  async removeRecurringSchedule(id: ID): Promise<void> {
    await getDB().recurringSchedules.delete(id);
  }

  // -- retainers -----------------------------------------------------------
  async listRetainers(status?: RetainerStatus): Promise<Retainer[]> {
    const db = getDB();
    const rows = status
      ? await db.retainers.where("status").equals(status).toArray()
      : await db.retainers.toArray();
    return rows.sort((a, b) => b.startDate - a.startDate);
  }

  async listRetainersByClient(clientId: ID): Promise<Retainer[]> {
    const rows = await getDB()
      .retainers.where("clientId")
      .equals(clientId)
      .toArray();
    return rows.sort((a, b) => b.startDate - a.startDate);
  }

  async getRetainer(id: ID): Promise<Retainer | undefined> {
    return getDB().retainers.get(id);
  }

  async createRetainer(input: RetainerCreateInput): Promise<Retainer> {
    const ts = now();
    const retainer: Retainer = {
      id: newId("rtn"),
      status: input.status ?? "active",
      createdAt: ts,
      updatedAt: ts,
      ...input,
    };
    await getDB().retainers.add(retainer);
    return retainer;
  }

  async updateRetainer(id: ID, patch: Partial<Retainer>): Promise<void> {
    await getDB().retainers.update(id, { ...patch, updatedAt: now() });
  }

  async removeRetainer(id: ID): Promise<void> {
    await getDB().retainers.delete(id);
  }

  // -- mileage -----------------------------------------------------------
  async listMileageEntries(): Promise<MileageEntry[]> {
    const rows = await getDB().mileageEntries.orderBy("date").toArray();
    return rows.reverse();
  }

  async getMileageEntry(id: ID): Promise<MileageEntry | undefined> {
    return getDB().mileageEntries.get(id);
  }

  async createMileageEntry(
    input: MileageEntryCreateInput,
  ): Promise<MileageEntry> {
    const ts = now();
    const entry: MileageEntry = {
      id: newId("mil"),
      isBilled: false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
      // Computed after the spread: an explicit `rate: undefined` in
      // unchecked runtime input must not clobber the default.
      rate:
        (input as { rate?: number }).rate ?? mileageRateForDate(input.date),
    } as MileageEntry;
    await getDB().mileageEntries.add(entry);
    return entry;
  }

  async updateMileageEntry(
    id: ID,
    patch: Partial<MileageEntry>,
  ): Promise<void> {
    await getDB().mileageEntries.update(id, { ...patch, updatedAt: now() });
  }

  async removeMileageEntry(id: ID): Promise<void> {
    await getDB().mileageEntries.delete(id);
  }

  // -- contracts ---------------------------------------------------------
  async listContracts(): Promise<Contract[]> {
    return getDB().contracts.orderBy("updatedAt").reverse().toArray();
  }

  async getContract(id: ID): Promise<Contract | undefined> {
    return getDB().contracts.get(id);
  }

  async createContract(input: ContractCreateInput): Promise<Contract> {
    const ts = now();
    const contract: Contract = {
      id: newId("ctr"),
      renewalNoticeDays: 30,
      archived: false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Contract;
    await getDB().contracts.add(contract);
    return contract;
  }

  async updateContract(id: ID, patch: Partial<Contract>): Promise<void> {
    await getDB().contracts.update(id, { ...patch, updatedAt: now() });
  }

  async removeContract(id: ID): Promise<void> {
    await getDB().contracts.delete(id);
  }

  // -- tax payments ------------------------------------------------------
  async listTaxPayments(): Promise<TaxPayment[]> {
    const rows = await getDB().taxPayments.orderBy("date").toArray();
    return rows.reverse();
  }

  async getTaxPayment(id: ID): Promise<TaxPayment | undefined> {
    return getDB().taxPayments.get(id);
  }

  async createTaxPayment(input: TaxPaymentCreateInput): Promise<TaxPayment> {
    const ts = now();
    const payment: TaxPayment = {
      id: newId("txp"),
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as TaxPayment;
    await getDB().taxPayments.add(payment);
    return payment;
  }

  async updateTaxPayment(id: ID, patch: Partial<TaxPayment>): Promise<void> {
    await getDB().taxPayments.update(id, { ...patch, updatedAt: now() });
  }

  async removeTaxPayment(id: ID): Promise<void> {
    await getDB().taxPayments.delete(id);
  }

  // -- rate cards --------------------------------------------------------
  async listRateCards(): Promise<RateCard[]> {
    return getDB().rateCards.orderBy("updatedAt").reverse().toArray();
  }

  async getRateCard(id: ID): Promise<RateCard | undefined> {
    return getDB().rateCards.get(id);
  }

  async createRateCard(input: RateCardCreateInput): Promise<RateCard> {
    const ts = now();
    const card: RateCard = {
      id: newId("rc"),
      archived: false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as RateCard;
    await getDB().rateCards.add(card);
    return card;
  }

  async updateRateCard(id: ID, patch: Partial<RateCard>): Promise<void> {
    await getDB().rateCards.update(id, { ...patch, updatedAt: now() });
  }

  async removeRateCard(id: ID): Promise<void> {
    await getDB().rateCards.delete(id);
  }

  // -- transactional domain workflows ------------------------------------
  async assignNextInvoiceNumber(): Promise<string> {
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

  async markInvoiceSent(invoice: Invoice): Promise<void> {
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

  async markInvoicePaid(invoiceId: ID): Promise<void> {
    const db = getDB();
    await db.invoices.update(invoiceId, {
      status: "paid",
      updatedAt: Date.now(),
    });
  }
}

/** The default (and currently only) storage provider: browser-local IndexedDB. */
export const dexieStorageProvider = new DexieStorageProvider();
