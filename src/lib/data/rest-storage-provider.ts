import { DEFAULT_SETTINGS, type Client, type Expense, type ID, type Invoice, type Project, type Settings, type Task } from "@/core/entities";
import { normalizeSettings } from "@/core/settings";
import { formatInvoiceNumber } from "@/core/invoice";
import type { RecurringSchedule, RecurringScheduleCreateInput, RecurringStatus, Retainer, RetainerCreateInput, RetainerStatus } from "@/core/recurring";
import type { MileageEntry, MileageEntryCreateInput } from "@/core/mileage";
import type { Contract, ContractCreateInput } from "@/core/contracts";
import type { TaxPayment, TaxPaymentCreateInput } from "@/core/tax";
import type { RateCard, RateCardCreateInput } from "@/core/rate-cards";
import type { ClientCreateInput, ExpenseCreateInput, InvoiceCreateInput, ProjectCreateInput, SettingsPatch, StorageProvider, TaskCreateInput } from "@/core/storage";
import { notifyDataChanged } from "./data-events";

type Envelope<T> = { data?: T; meta?: { nextCursor: string | null } };

export class NotSupportedError extends Error {
  constructor(message = "This feature is not supported by the cloud provider.") {
    super(message);
    this.name = "NotSupportedError";
  }
}

export class RestStorageProvider implements StorageProvider {
  readonly providerName = "rest";
  private readonly base = "/api/v1";

  private async request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | undefined> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-tallyhand-sync": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`REST ${method} ${path} failed (${response.status})`);
    if (response.status === 204) return undefined;
    return (await response.json()) as T;
  }

  private async list<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const result: Envelope<T[]> | undefined = await this.request<Envelope<T[]>>("GET", `${path}${suffix}`);
      all.push(...(result?.data ?? []));
      cursor = result?.meta?.nextCursor ?? null;
    } while (cursor !== null);
    return all;
  }

  private async get<T>(path: string): Promise<T | undefined> {
    const result = await this.request<Envelope<T>>("GET", path, undefined, true);
    return result?.data;
  }

  private async create<T>(path: string, input: unknown): Promise<T> {
    const result = await this.request<Envelope<T>>("POST", path, input);
    notifyDataChanged();
    return result!.data as T;
  }

  private async update(path: string, patch: unknown): Promise<void> {
    await this.request("PATCH", path, patch);
    notifyDataChanged();
  }

  private async remove(path: string): Promise<void> {
    await this.request("DELETE", path);
    notifyDataChanged();
  }

  private async extList<T>(path: string): Promise<T[]> {
    try { return await this.list<T>(path); }
    catch (error) { if (error instanceof Error && error.message === `REST GET ${path} failed (501)`) return []; throw error; }
  }
  private async extGet<T>(path: string): Promise<T | undefined> {
    try { return await this.get<T>(path); }
    catch (error) { if (error instanceof Error && error.message === `REST GET ${path} failed (501)`) return undefined; throw error; }
  }
  private async extCreate<T>(path: string, body: unknown): Promise<T> {
    try {
      const result = await this.request<Envelope<T>>("POST", path, body);
      notifyDataChanged();
      return result?.data as T;
    }
    catch (error) { if (error instanceof Error && error.message === `REST POST ${path} failed (501)`) throw new NotSupportedError(); throw error; }
  }
  private async extWrite(path: string, method: "PATCH" | "DELETE", body?: unknown): Promise<void> {
    try { await this.request(method, path, body); notifyDataChanged(); }
    catch (error) { if (error instanceof Error && error.message === `REST ${method} ${path} failed (501)`) throw new NotSupportedError(); throw error; }
  }

  async listClients(includeArchived = false): Promise<Client[]> { const rows = await this.list<Client>("/clients"); return includeArchived ? rows : rows.filter((x) => !x.archived); }
  getClient(id: ID) { return this.get<Client>(`/clients/${encodeURIComponent(id)}`); }
  createClient(input: ClientCreateInput) { return this.create<Client>("/clients", input); }
  updateClient(id: ID, patch: Partial<Client>) { return this.update(`/clients/${encodeURIComponent(id)}`, patch); }
  removeClient(id: ID) { return this.remove(`/clients/${encodeURIComponent(id)}`); }

  listProjects() { return this.list<Project>("/projects"); }
  async listProjectsByClient(clientId: ID) { return (await this.listProjects()).filter((x) => x.clientId === clientId); }
  getProject(id: ID) { return this.get<Project>(`/projects/${encodeURIComponent(id)}`); }
  createProject(input: ProjectCreateInput) { return this.create<Project>("/projects", input); }
  updateProject(id: ID, patch: Partial<Project>) { return this.update(`/projects/${encodeURIComponent(id)}`, patch); }
  removeProject(id: ID) { return this.remove(`/projects/${encodeURIComponent(id)}`); }

  listTasks() { return this.list<Task>("/tasks"); }
  getTask(id: ID) { return this.get<Task>(`/tasks/${encodeURIComponent(id)}`); }
  async listTasksByProject(projectId: ID) { return (await this.listTasks()).filter((x) => x.projectId === projectId); }
  async listUnbilledTasks() { return (await this.listTasks()).filter((x) => !x.isBilled); }
  createTask(input: TaskCreateInput) { return this.create<Task>("/tasks", input); }
  updateTask(id: ID, patch: Partial<Task>) { return this.update(`/tasks/${encodeURIComponent(id)}`, patch); }
  removeTask(id: ID) { return this.remove(`/tasks/${encodeURIComponent(id)}`); }

  listExpenses() { return this.list<Expense>("/expenses"); }
  getExpense(id: ID) { return this.get<Expense>(`/expenses/${encodeURIComponent(id)}`); }
  createExpense(input: ExpenseCreateInput) { return this.create<Expense>("/expenses", input); }
  updateExpense(id: ID, patch: Partial<Expense>) { return this.update(`/expenses/${encodeURIComponent(id)}`, patch); }
  removeExpense(id: ID) { return this.remove(`/expenses/${encodeURIComponent(id)}`); }

  listInvoices() { return this.list<Invoice>("/invoices"); }
  getInvoice(id: ID) { return this.get<Invoice>(`/invoices/${encodeURIComponent(id)}`); }
  async getInvoiceByPublicToken(token: string) { if (!token) return undefined; return (await this.listInvoices()).find((x) => x.publicToken === token); }
  createInvoice(input: InvoiceCreateInput) { return this.create<Invoice>("/invoices", input); }
  updateInvoice(id: ID, patch: Partial<Invoice>) { return this.update(`/invoices/${encodeURIComponent(id)}`, patch); }
  removeInvoice(id: ID) { return this.remove(`/invoices/${encodeURIComponent(id)}`); }

  async readSettings() { const result = await this.request<Envelope<Settings>>("GET", "/settings"); return result?.data; }
  async getSettings() { return normalizeSettings((await this.readSettings()) ?? DEFAULT_SETTINGS); }
  async updateSettings(patch: SettingsPatch) { const result = await this.request<Envelope<Settings>>("PATCH", "/settings", patch); notifyDataChanged(); return result!.data as Settings; }

  async listRecurringSchedules(status?: RecurringStatus) { const rows = await this.list<RecurringSchedule>("/recurring-schedules"); return rows.filter((x) => !status || x.status === status).sort((a, b) => a.nextRunAt - b.nextRunAt); }
  async listRecurringSchedulesByClient(clientId: ID) { return (await this.list<RecurringSchedule>("/recurring-schedules")).filter((x) => x.clientId === clientId).sort((a, b) => a.nextRunAt - b.nextRunAt); }
  getRecurringSchedule(id: ID) { return this.get<RecurringSchedule>(`/recurring-schedules/${encodeURIComponent(id)}`); }
  createRecurringSchedule(input: RecurringScheduleCreateInput) { return this.create<RecurringSchedule>("/recurring-schedules", input); }
  updateRecurringSchedule(id: ID, patch: Partial<RecurringSchedule>) { return this.update(`/recurring-schedules/${encodeURIComponent(id)}`, patch); }
  removeRecurringSchedule(id: ID) { return this.remove(`/recurring-schedules/${encodeURIComponent(id)}`); }

  async listRetainers(status?: RetainerStatus) { const rows = await this.list<Retainer>("/retainers"); return rows.filter((x) => !status || x.status === status).sort((a, b) => b.startDate - a.startDate); }
  async listRetainersByClient(clientId: ID) { return (await this.list<Retainer>("/retainers")).filter((x) => x.clientId === clientId).sort((a, b) => b.startDate - a.startDate); }
  getRetainer(id: ID) { return this.get<Retainer>(`/retainers/${encodeURIComponent(id)}`); }
  createRetainer(input: RetainerCreateInput) { return this.create<Retainer>("/retainers", input); }
  updateRetainer(id: ID, patch: Partial<Retainer>) { return this.update(`/retainers/${encodeURIComponent(id)}`, patch); }
  removeRetainer(id: ID) { return this.remove(`/retainers/${encodeURIComponent(id)}`); }

  async assignNextInvoiceNumber() { const settings = await this.getSettings(); const number = formatInvoiceNumber(settings.invoice.numberPrefix, settings.invoice.nextNumber); await this.updateSettings({ invoice: { nextNumber: settings.invoice.nextNumber + 1 } }); return number; }
  async markInvoiceSent(invoice: Invoice) { await this.request("POST", `/invoices/${encodeURIComponent(invoice.id)}/send`, {}); notifyDataChanged(); }
  async markInvoicePaid(invoiceId: ID) { await this.request("POST", `/invoices/${encodeURIComponent(invoiceId)}/paid`, {}); notifyDataChanged(); }

  listMileageEntries() { return this.extList<MileageEntry>("/mileage"); }
  getMileageEntry(id: ID) { return this.extGet<MileageEntry>(`/mileage/${encodeURIComponent(id)}`); }
  createMileageEntry(input: MileageEntryCreateInput) { return this.extCreate<MileageEntry>("/mileage", input); }
  updateMileageEntry(id: ID, patch: Partial<MileageEntry>) { return this.extWrite(`/mileage/${encodeURIComponent(id)}`, "PATCH", patch); }
  removeMileageEntry(id: ID) { return this.extWrite(`/mileage/${encodeURIComponent(id)}`, "DELETE"); }

  listContracts() { return this.extList<Contract>("/contracts"); }
  getContract(id: ID) { return this.extGet<Contract>(`/contracts/${encodeURIComponent(id)}`); }
  createContract(input: ContractCreateInput) { return this.extCreate<Contract>("/contracts", input); }
  updateContract(id: ID, patch: Partial<Contract>) { return this.extWrite(`/contracts/${encodeURIComponent(id)}`, "PATCH", patch); }
  removeContract(id: ID) { return this.extWrite(`/contracts/${encodeURIComponent(id)}`, "DELETE"); }

  listTaxPayments() { return this.extList<TaxPayment>("/tax-payments"); }
  getTaxPayment(id: ID) { return this.extGet<TaxPayment>(`/tax-payments/${encodeURIComponent(id)}`); }
  createTaxPayment(input: TaxPaymentCreateInput) { return this.extCreate<TaxPayment>("/tax-payments", input); }
  updateTaxPayment(id: ID, patch: Partial<TaxPayment>) { return this.extWrite(`/tax-payments/${encodeURIComponent(id)}`, "PATCH", patch); }
  removeTaxPayment(id: ID) { return this.extWrite(`/tax-payments/${encodeURIComponent(id)}`, "DELETE"); }

  listRateCards() { return this.extList<RateCard>("/rate-cards"); }
  getRateCard(id: ID) { return this.extGet<RateCard>(`/rate-cards/${encodeURIComponent(id)}`); }
  createRateCard(input: RateCardCreateInput) { return this.extCreate<RateCard>("/rate-cards", input); }
  updateRateCard(id: ID, patch: Partial<RateCard>) { return this.extWrite(`/rate-cards/${encodeURIComponent(id)}`, "PATCH", patch); }
  removeRateCard(id: ID) { return this.extWrite(`/rate-cards/${encodeURIComponent(id)}`, "DELETE"); }
}

export const restStorageProvider = new RestStorageProvider();
