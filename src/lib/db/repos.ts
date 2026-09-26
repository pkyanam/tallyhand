import { dexieStorageProvider } from "./dexie-provider";
import { pluginRegistry } from "@/plugins/registry";
import type {
  ClientCreateInput,
  ContractCreateInput,
  ExpenseCreateInput,
  InvoiceCreateInput,
  MileageEntryCreateInput,
  ProjectCreateInput,
  RateCardCreateInput,
  StorageProvider,
  SettingsPatch,
  TaskCreateInput,
  TaxPaymentCreateInput,
} from "@/core/storage";
import type {
  Client,
  Expense,
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
import type { MileageEntry } from "@/core/mileage";
import type { Contract } from "@/core/contracts";
import type { TaxPayment } from "@/core/tax";
import type { RateCard } from "@/core/rate-cards";

/**
 * Active storage backend. Defaults to the Dexie (IndexedDB) provider.
 * Swap via `setStorageProvider` (e.g. in tests, or for a future sync-server
 * / hosted Postgres provider). Repos always program against the
 * `StorageProvider` interface — never against Dexie directly.
 */
let activeProvider: StorageProvider = dexieStorageProvider;

export function setStorageProvider(provider: StorageProvider): void {
  activeProvider = provider;
}

export function getStorageProvider(): StorageProvider {
  return activeProvider;
}

export const clientRepo = {
  list(includeArchived = false): Promise<Client[]> {
    return activeProvider.listClients(includeArchived);
  },
  get(id: string): Promise<Client | undefined> {
    return activeProvider.getClient(id);
  },
  create(input: ClientCreateInput): Promise<Client> {
    return activeProvider.createClient(input);
  },
  update(id: string, patch: Partial<Client>): Promise<void> {
    return activeProvider.updateClient(id, patch);
  },
  archive(id: string): Promise<void> {
    return activeProvider.updateClient(id, { archived: true });
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeClient(id);
  },
};

export const projectRepo = {
  listByClient(clientId: string): Promise<Project[]> {
    return activeProvider.listProjectsByClient(clientId);
  },
  list(): Promise<Project[]> {
    return activeProvider.listProjects();
  },
  get(id: string): Promise<Project | undefined> {
    return activeProvider.getProject(id);
  },
  create(input: ProjectCreateInput): Promise<Project> {
    return activeProvider.createProject(input);
  },
  update(id: string, patch: Partial<Project>): Promise<void> {
    return activeProvider.updateProject(id, patch);
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeProject(id);
  },
};

export const taskRepo = {
  list(): Promise<Task[]> {
    return activeProvider.listTasks();
  },
  get(id: string): Promise<Task | undefined> {
    return activeProvider.getTask(id);
  },
  listByProject(projectId: string): Promise<Task[]> {
    return activeProvider.listTasksByProject(projectId);
  },
  listUnbilled(): Promise<Task[]> {
    return activeProvider.listUnbilledTasks();
  },
  async create(input: TaskCreateInput): Promise<Task> {
    const task = await activeProvider.createTask(input);
    await pluginRegistry.emit("onTaskCreated", task);
    return task;
  },
  async update(id: string, patch: Partial<Task>): Promise<void> {
    await activeProvider.updateTask(id, patch);
    const current = await activeProvider.getTask(id);
    if (current) {
      await pluginRegistry.emit("onTaskUpdated", current);
    }
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeTask(id);
  },
};

export const expenseRepo = {
  list(): Promise<Expense[]> {
    return activeProvider.listExpenses();
  },
  get(id: string): Promise<Expense | undefined> {
    return activeProvider.getExpense(id);
  },
  async create(input: ExpenseCreateInput): Promise<Expense> {
    const expense = await activeProvider.createExpense(input);
    await pluginRegistry.emit("onExpenseCreated", expense);
    return expense;
  },
  update(id: string, patch: Partial<Expense>): Promise<void> {
    return activeProvider.updateExpense(id, patch);
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeExpense(id);
  },
};

export const invoiceRepo = {
  list(): Promise<Invoice[]> {
    return activeProvider.listInvoices();
  },
  get(id: string): Promise<Invoice | undefined> {
    return activeProvider.getInvoice(id);
  },
  getByPublicToken(token: string): Promise<Invoice | undefined> {
    return activeProvider.getInvoiceByPublicToken(token);
  },
  create(input: InvoiceCreateInput): Promise<Invoice> {
    return activeProvider.createInvoice(input);
  },
  update(id: string, patch: Partial<Invoice>): Promise<void> {
    return activeProvider.updateInvoice(id, patch);
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeInvoice(id);
  },
};

export const recurringScheduleRepo = {
  list(status?: RecurringStatus): Promise<RecurringSchedule[]> {
    return activeProvider.listRecurringSchedules(status);
  },
  listByClient(clientId: string): Promise<RecurringSchedule[]> {
    return activeProvider.listRecurringSchedulesByClient(clientId);
  },
  get(id: string): Promise<RecurringSchedule | undefined> {
    return activeProvider.getRecurringSchedule(id);
  },
  create(input: RecurringScheduleCreateInput): Promise<RecurringSchedule> {
    return activeProvider.createRecurringSchedule(input);
  },
  update(id: string, patch: Partial<RecurringSchedule>): Promise<void> {
    return activeProvider.updateRecurringSchedule(id, patch);
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeRecurringSchedule(id);
  },
};

export const retainerRepo = {
  list(status?: RetainerStatus): Promise<Retainer[]> {
    return activeProvider.listRetainers(status);
  },
  listByClient(clientId: string): Promise<Retainer[]> {
    return activeProvider.listRetainersByClient(clientId);
  },
  get(id: string): Promise<Retainer | undefined> {
    return activeProvider.getRetainer(id);
  },
  create(input: RetainerCreateInput): Promise<Retainer> {
    return activeProvider.createRetainer(input);
  },
  update(id: string, patch: Partial<Retainer>): Promise<void> {
    return activeProvider.updateRetainer(id, patch);
  },
  remove(id: string): Promise<void> {
    return activeProvider.removeRetainer(id);
  },
};

/**
 * Keys of the optional extension stores (mileage, contracts, tax payments,
 * rate cards) on StorageProvider. Extract keeps this provably a subset of
 * keyof StorageProvider so indexed access typechecks.
 */
type ExtensionStoreKey = Extract<
  keyof StorageProvider,
  | "listMileageEntries"
  | "getMileageEntry"
  | "createMileageEntry"
  | "updateMileageEntry"
  | "removeMileageEntry"
  | "listContracts"
  | "getContract"
  | "createContract"
  | "updateContract"
  | "removeContract"
  | "listTaxPayments"
  | "getTaxPayment"
  | "createTaxPayment"
  | "updateTaxPayment"
  | "removeTaxPayment"
  | "listRateCards"
  | "getRateCard"
  | "createRateCard"
  | "updateRateCard"
  | "removeRateCard"
>;

/**
 * Resolve an optional extension-store method (mileage, contracts, tax
 * payments, rate cards) from the active provider. Older providers
 * (Postgres, Convex) predate these entities and get a clear error instead
 * of a confusing `not a function` crash.
 */
function extStore<K extends ExtensionStoreKey>(
  key: K,
): NonNullable<StorageProvider[K]> {
  const fn = activeProvider[key];
  if (typeof fn !== "function") {
    throw new Error(
      `"${key}" is not supported by the "${activeProvider.providerName}" storage provider.`,
    );
  }
  return (fn as (...args: never[]) => unknown).bind(
    activeProvider,
  ) as NonNullable<StorageProvider[K]>;
}

export const mileageRepo = {
  list(): Promise<MileageEntry[]> {
    return extStore("listMileageEntries")();
  },
  get(id: string): Promise<MileageEntry | undefined> {
    return extStore("getMileageEntry")(id);
  },
  create(input: MileageEntryCreateInput): Promise<MileageEntry> {
    return extStore("createMileageEntry")(input);
  },
  update(id: string, patch: Partial<MileageEntry>): Promise<void> {
    return extStore("updateMileageEntry")(id, patch);
  },
  remove(id: string): Promise<void> {
    return extStore("removeMileageEntry")(id);
  },
};

export const contractRepo = {
  list(): Promise<Contract[]> {
    return extStore("listContracts")();
  },
  listByClient(clientId: string): Promise<Contract[]> {
    return extStore("listContracts")().then((all) =>
      all.filter((c) => c.clientId === clientId),
    );
  },
  get(id: string): Promise<Contract | undefined> {
    return extStore("getContract")(id);
  },
  create(input: ContractCreateInput): Promise<Contract> {
    return extStore("createContract")(input);
  },
  update(id: string, patch: Partial<Contract>): Promise<void> {
    return extStore("updateContract")(id, patch);
  },
  remove(id: string): Promise<void> {
    return extStore("removeContract")(id);
  },
};

export const taxPaymentRepo = {
  list(): Promise<TaxPayment[]> {
    return extStore("listTaxPayments")();
  },
  listByYear(taxYear: number): Promise<TaxPayment[]> {
    return extStore("listTaxPayments")().then((all) =>
      all.filter((p) => p.taxYear === taxYear),
    );
  },
  get(id: string): Promise<TaxPayment | undefined> {
    return extStore("getTaxPayment")(id);
  },
  create(input: TaxPaymentCreateInput): Promise<TaxPayment> {
    return extStore("createTaxPayment")(input);
  },
  update(id: string, patch: Partial<TaxPayment>): Promise<void> {
    return extStore("updateTaxPayment")(id, patch);
  },
  remove(id: string): Promise<void> {
    return extStore("removeTaxPayment")(id);
  },
};

export const rateCardRepo = {
  list(): Promise<RateCard[]> {
    return extStore("listRateCards")();
  },
  listByClient(clientId: string): Promise<RateCard[]> {
    return extStore("listRateCards")().then((all) =>
      all.filter((c) => c.clientId === clientId),
    );
  },
  get(id: string): Promise<RateCard | undefined> {
    return extStore("getRateCard")(id);
  },
  create(input: RateCardCreateInput): Promise<RateCard> {
    return extStore("createRateCard")(input);
  },
  update(id: string, patch: Partial<RateCard>): Promise<void> {
    return extStore("updateRateCard")(id, patch);
  },
  remove(id: string): Promise<void> {
    return extStore("removeRateCard")(id);
  },
};

export const settingsRepo = { // Pure read — safe inside useLiveQuery. Returns undefined if the singleton  // row has not been written yet.
  read(): Promise<Settings | undefined> {
    return activeProvider.readSettings();
  },
  // Read-or-initialize. May write the default row if missing. Do NOT call this
  // inside a Dexie liveQuery callback (Dexie forbids writes from querier
  // functions and will silently loop). Call from effects or event handlers.
  get(): Promise<Settings> {
    return activeProvider.getSettings();
  },
  update(patch: SettingsPatch): Promise<Settings> {
    return activeProvider.updateSettings(patch);
  },
};
