/**
 * ConvexStorageProvider — hosted-mode StorageProvider over Convex
 * (`TALLY_STORAGE=convex`).
 *
 * SERVER ONLY — never import from client components.
 *
 * Calls the functions in `convex/tally.ts` through `ConvexHttpClient`.
 * String paths (`"tally:clientsList"`) are converted to function references
 * with `makeFunctionReference`, so no Convex codegen import is
 * needed on the Next.js side. Deploy the Convex functions first
 * (`convex dev` / `npx convex deploy`) and set CONVEX_URL.
 *
 * PER-USER ISOLATION: every call passes `userId` (resolved lazily per
 * request, exactly like the Postgres provider), and every Convex function
 * re-scopes by it. The only intentionally user-less call is
 * `getShareLinkById` — the public share-token capability lookup, which runs
 * after HMAC signature verification.
 *
 * Convex rejects `undefined` in args, so every payload is stripped of
 * undefined values before sending (`cleanArgs`).
 */
import { newId } from "@/core/id";
import type { MileageEntry, MileageEntryCreateInput } from "@/core/mileage";
import type { Contract, ContractCreateInput } from "@/core/contracts";
import type { TaxPayment, TaxPaymentCreateInput } from "@/core/tax";
import type { RateCard, RateCardCreateInput } from "@/core/rate-cards";

import { newShareLinkId, type ShareLinkType } from "@/core/share";
import type {
  Client,
  Expense,
  ID,
  Invoice,
  Project,
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
import type {
  ClientCreateInput,
  ExpenseCreateInput,
  InvoiceCreateInput,
  ProjectCreateInput,
  SettingsPatch,
  StorageProvider,
  TaskCreateInput,
} from "@/core/storage";
import type { Settings } from "@/core/entities";
import {
  dbJsonArr,
  dbNum,
  dbOptBool,
  dbOptNum,
  dbOptStr,
  dbStr,
  dbStrArr,
  type DbRow,
  type ShareLinkCreateInput,
  type ShareLinkRow,
  type TimesheetApprovalInput,
  type TimesheetApprovalRow,
  type UserIdSource,
} from "./hosted-types";

/** Minimal surface of ConvexHttpClient used here (string function paths). */
export interface ConvexClientLike {
  query(path: string, args: Record<string, unknown>): Promise<unknown>;
  mutation(path: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Convex rejects undefined in args — strip them (recursively for patch). */
export function cleanArgs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cleanArgs) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = cleanArgs(v);
    }
    return out as T;
  }
  return value;
}

function toClient(d: DbRow): Client {
  return {
    id: dbStr(d, "id"), name: dbStr(d, "name"),
    email: dbOptStr(d, "email"), address: dbOptStr(d, "address"),
    defaultRate: dbOptNum(d, "defaultRate"), notes: dbOptStr(d, "notes"),
    archived: Boolean(d.archived), createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toProject(d: DbRow): Project {
  return {
    id: dbStr(d, "id"), clientId: dbStr(d, "clientId"), name: dbStr(d, "name"),
    rateOverride: dbOptNum(d, "rateOverride"), archived: Boolean(d.archived),
    createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toTask(d: DbRow): Task {
  return {
    id: dbStr(d, "id"), projectId: dbStr(d, "projectId"), name: dbStr(d, "name"),
    startAt: dbNum(d, "startAt"), endAt: dbNum(d, "endAt"), durationMinutes: dbNum(d, "durationMinutes"),
    notes: dbOptStr(d, "notes"), tags: dbStrArr(d, "tags"),
    isBilled: Boolean(d.isBilled), invoiceId: dbOptStr(d, "invoiceId"),
    createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toExpense(d: DbRow): Expense {
  return {
    id: dbStr(d, "id"), clientId: dbOptStr(d, "clientId"), projectId: dbOptStr(d, "projectId"),
    date: dbNum(d, "date"), amount: dbNum(d, "amount"), category: dbStr(d, "category"),
    note: dbOptStr(d, "note"), receiptB64: dbOptStr(d, "receiptB64"),
    isBilled: Boolean(d.isBilled), invoiceId: dbOptStr(d, "invoiceId"),
    createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toInvoice(d: DbRow): Invoice {
  return {
    id: dbStr(d, "id"), clientId: dbStr(d, "clientId"), invoiceNumber: dbStr(d, "invoiceNumber"),
    issueDate: dbNum(d, "issueDate"), dueDate: dbNum(d, "dueDate"), status: dbStr(d, "status") as Invoice["status"],
    lineItems: dbJsonArr(d, "lineItems") as Invoice["lineItems"],
    subtotal: dbNum(d, "subtotal"), total: dbNum(d, "total"),
    notes: dbOptStr(d, "notes"), publicToken: dbOptStr(d, "publicToken"),
    currency: dbOptStr(d, "currency"),
    taxRegion: dbOptStr(d, "taxRegion") as Invoice["taxRegion"],
    sellerTaxId: dbOptStr(d, "sellerTaxId"),
    sellerTaxIdLabel: dbOptStr(d, "sellerTaxIdLabel"),
    buyerTaxId: dbOptStr(d, "buyerTaxId"),
    sellerEmailVisible: dbOptBool(d, "sellerEmailVisible"),
    buyerEmailVisible: dbOptBool(d, "buyerEmailVisible"),
    serviceStart: dbOptNum(d, "serviceStart"),
    serviceEnd: dbOptNum(d, "serviceEnd"),
    invoiceType: dbOptStr(d, "invoiceType"),
    paymentMethod: dbOptStr(d, "paymentMethod"),
    paymentUrl: dbOptStr(d, "paymentUrl"),
    bankAccount: dbOptStr(d, "bankAccount"),
    swiftBic: dbOptStr(d, "swiftBic"),
    qrEnabled: dbOptBool(d, "qrEnabled"),
    qrPayload: dbOptStr(d, "qrPayload"),
    qrDescription: dbOptStr(d, "qrDescription"),
    amountInWords: dbOptBool(d, "amountInWords"),
    template: dbOptStr(d, "template") as Invoice["template"],
    createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toRecurringSchedule(d: DbRow): RecurringSchedule {
  return {
    id: dbStr(d, "id"), clientId: dbStr(d, "clientId"), projectId: dbOptStr(d, "projectId"),
    name: dbStr(d, "name"), mode: dbStr(d, "mode") as RecurringSchedule["mode"], frequency: dbStr(d, "frequency") as RecurringSchedule["frequency"], interval: dbNum(d, "interval"),
    lineItems: dbJsonArr(d, "lineItems") as RecurringSchedule["lineItems"],
    startDate: dbNum(d, "startDate"), endDate: dbOptNum(d, "endDate"),
    maxOccurrences: dbOptNum(d, "maxOccurrences"),
    nextRunAt: dbNum(d, "nextRunAt"), lastRunAt: dbOptNum(d, "lastRunAt"),
    occurrences: dbNum(d, "occurrences"), status: dbStr(d, "status") as RecurringSchedule["status"],
    notes: dbOptStr(d, "notes"), createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toRetainer(d: DbRow): Retainer {
  return {
    id: dbStr(d, "id"), clientId: dbStr(d, "clientId"), name: dbStr(d, "name"), type: dbStr(d, "type") as Retainer["type"],
    totalHours: dbOptNum(d, "totalHours"), amountCents: dbNum(d, "amountCents"),
    hourlyRate: dbOptNum(d, "hourlyRate"),
    startDate: dbNum(d, "startDate"), endDate: dbOptNum(d, "endDate"), status: dbStr(d, "status") as Retainer["status"],
    recurringScheduleId: dbOptStr(d, "recurringScheduleId"),
    notes: dbOptStr(d, "notes"), createdAt: dbNum(d, "createdAt"), updatedAt: dbNum(d, "updatedAt"),
  };
}
function toShareLink(d: DbRow): ShareLinkRow {
  return {
    id: dbStr(d, "id"), userId: dbStr(d, "userId"), type: dbStr(d, "type") as ShareLinkType, target: d.target,
    expiresAt: dbNum(d, "expiresAt"), revokedAt: (d.revokedAt as number | null | undefined) ?? null, createdAt: dbNum(d, "createdAt"),
  };
}
function toApproval(d: DbRow): TimesheetApprovalRow {
  return {
    id: dbStr(d, "id"), userId: dbStr(d, "userId"), shareLinkId: dbStr(d, "shareLinkId"), clientId: dbStr(d, "clientId"),
    weekStartMs: dbNum(d, "weekStartMs"), approvedAt: dbNum(d, "approvedAt"),
    approverName: dbOptStr(d, "approverName"), note: dbOptStr(d, "note"),
  };
}

export class ConvexStorageProvider implements StorageProvider {
  readonly providerName = "convex";

  /**
   * Production factory: builds a ConvexHttpClient for CONVEX_URL.
   * Dynamic requires keep `convex` out of the static import graph.
   *
   * ConvexHttpClient needs FunctionReference objects (not raw strings), so
   * the real client is adapted behind the string-path ConvexClientLike
   * surface via `makeFunctionReference` — no Convex codegen import needed.
   */
  static async create(
    convexUrl: string,
    userId: UserIdSource,
  ): Promise<ConvexStorageProvider> {
    const { createConvexRequestClient } = await import("./convex-client");
    const client = createConvexRequestClient(convexUrl);
    return new ConvexStorageProvider(client, userId);
  }

  constructor(
    private readonly client: ConvexClientLike,
    private readonly userIdSource: UserIdSource,
  ) {}

  private async uid(): Promise<string> {
    const id =
      typeof this.userIdSource === "string"
        ? this.userIdSource
        : await this.userIdSource();
    if (!id) throw new Error("Convex provider requires a user id");
    return id;
  }

  private async q(path: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.query(`tally:${path}`, cleanArgs({ userId: await this.uid(), ...args }));
  }

  private async m(path: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.mutation(`tally:${path}`, cleanArgs({ userId: await this.uid(), ...args }));
  }

  // -- clients -----------------------------------------------------------
  async listClients(includeArchived = false): Promise<Client[]> {
    const docs = await this.q("clientsList", { includeArchived });
    return (docs as DbRow[]).map(toClient);
  }
  async getClient(id: ID): Promise<Client | undefined> {
    const d = (await this.q("clientsGet", { id })) as DbRow | null;
    return d ? toClient(d) : undefined;
  }
  async createClient(input: ClientCreateInput): Promise<Client> {
    const d = (await this.m("clientsCreate", { id: input.id ?? newId("cli"), ...input })) as DbRow;
    return toClient(d);
  }
  async updateClient(id: ID, patch: Partial<Client>): Promise<void> {
    await this.m("clientsUpdate", { id, patch });
  }
  async removeClient(id: ID): Promise<void> {
    await this.m("clientsRemove", { id });
  }

  // -- projects ----------------------------------------------------------
  async listProjects(): Promise<Project[]> {
    return ((await this.q("projectsList")) as DbRow[]).map(toProject);
  }
  async listProjectsByClient(clientId: ID): Promise<Project[]> {
    return ((await this.q("projectsListByClient", { clientId })) as DbRow[]).map(toProject);
  }
  async getProject(id: ID): Promise<Project | undefined> {
    const d = (await this.q("projectsGet", { id })) as DbRow | null;
    return d ? toProject(d) : undefined;
  }
  async createProject(input: ProjectCreateInput): Promise<Project> {
    const d = (await this.m("projectsCreate", { id: input.id ?? newId("prj"), ...input })) as DbRow;
    return toProject(d);
  }
  async updateProject(id: ID, patch: Partial<Project>): Promise<void> {
    await this.m("projectsUpdate", { id, patch });
  }
  async removeProject(id: ID): Promise<void> {
    await this.m("projectsRemove", { id });
  }

  // -- tasks -------------------------------------------------------------
  async listTasks(): Promise<Task[]> {
    return ((await this.q("tasksList")) as DbRow[]).map(toTask);
  }
  async getTask(id: ID): Promise<Task | undefined> {
    const d = (await this.q("tasksGet", { id })) as DbRow | null;
    return d ? toTask(d) : undefined;
  }
  async listTasksByProject(projectId: ID): Promise<Task[]> {
    return ((await this.q("tasksListByProject", { projectId })) as DbRow[]).map(toTask);
  }
  async listUnbilledTasks(): Promise<Task[]> {
    return ((await this.q("tasksListUnbilled")) as DbRow[]).map(toTask);
  }
  async createTask(input: TaskCreateInput): Promise<Task> {
    const durationMinutes =
      input.durationMinutes ??
      Math.max(0, Math.round((input.endAt - input.startAt) / 60000));
    const d = await this.m("tasksCreate", {
      id: input.id ?? newId("tsk"),
      ...input,
      durationMinutes,
      tags: input.tags ?? [],
      isBilled: input.isBilled ?? false,
    });
    return toTask(d as DbRow);
  }
  async updateTask(id: ID, patch: Partial<Task>): Promise<void> {
    const next: Record<string, unknown> = { ...patch };
    if (patch.startAt != null || patch.endAt != null) {
      const existing = await this.getTask(id);
      if (existing) {
        const startAt = (patch.startAt ?? existing.startAt) as number;
        const endAt = (patch.endAt ?? existing.endAt) as number;
        next.durationMinutes = Math.max(0, Math.round((endAt - startAt) / 60000));
      }
    }
    await this.m("tasksUpdate", { id, patch: next });
  }
  async removeTask(id: ID): Promise<void> {
    await this.m("tasksRemove", { id });
  }

  // -- expenses ----------------------------------------------------------
  async listExpenses(): Promise<Expense[]> {
    return ((await this.q("expensesList")) as DbRow[]).map(toExpense);
  }
  async getExpense(id: ID): Promise<Expense | undefined> {
    const d = (await this.q("expensesGet", { id })) as DbRow | null;
    return d ? toExpense(d) : undefined;
  }
  async createExpense(input: ExpenseCreateInput): Promise<Expense> {
    const d = await this.m("expensesCreate", {
      id: input.id ?? newId("exp"),
      ...input,
      isBilled: input.isBilled ?? false,
    });
    return toExpense(d as DbRow);
  }
  async updateExpense(id: ID, patch: Partial<Expense>): Promise<void> {
    await this.m("expensesUpdate", { id, patch });
  }
  async removeExpense(id: ID): Promise<void> {
    await this.m("expensesRemove", { id });
  }

  // -- invoices ----------------------------------------------------------
  async listInvoices(): Promise<Invoice[]> {
    return ((await this.q("invoicesList")) as DbRow[]).map(toInvoice);
  }
  async getInvoice(id: ID): Promise<Invoice | undefined> {
    const d = (await this.q("invoicesGet", { id })) as DbRow | null;
    return d ? toInvoice(d) : undefined;
  }
  async getInvoiceByPublicToken(token: string): Promise<Invoice | undefined> {
    if (!token) return undefined;
    const d = (await this.q("invoicesGetByPublicToken", { token })) as DbRow | null;
    return d ? toInvoice(d) : undefined;
  }
  async createInvoice(input: InvoiceCreateInput): Promise<Invoice> {
    const d = (await this.m("invoicesCreate", { id: input.id ?? newId("inv"), ...input })) as DbRow;
    return toInvoice(d);
  }
  async updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
    await this.m("invoicesUpdate", { id, patch });
  }
  async removeInvoice(id: ID): Promise<void> {
    await this.m("invoicesRemove", { id });
  }

  // -- settings ----------------------------------------------------------
  async readSettings(): Promise<Settings | undefined> {
    const d = (await this.q("settingsRead")) as unknown as Settings | undefined;
    return d ?? undefined;
  }
  async getSettings(): Promise<Settings> {
    return (await this.m("settingsGet")) as unknown as Settings;
  }
  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    return (await this.m("settingsUpdate", { patch })) as unknown as Settings;
  }

  // -- recurring schedules ------------------------------------------------
  async listRecurringSchedules(status?: RecurringStatus): Promise<RecurringSchedule[]> {
    const docs = await this.q("recurringList", status ? { status } : {});
    return (docs as DbRow[]).map(toRecurringSchedule);
  }
  async listRecurringSchedulesByClient(clientId: ID): Promise<RecurringSchedule[]> {
    return ((await this.q("recurringListByClient", { clientId })) as DbRow[]).map(toRecurringSchedule);
  }
  async getRecurringSchedule(id: ID): Promise<RecurringSchedule | undefined> {
    const d = (await this.q("recurringGet", { id })) as DbRow | null;
    return d ? toRecurringSchedule(d) : undefined;
  }
  async createRecurringSchedule(input: RecurringScheduleCreateInput): Promise<RecurringSchedule> {
    const d = (await this.m("recurringCreate", { id: newId("rsd"), ...input })) as DbRow;
    return toRecurringSchedule(d);
  }
  async updateRecurringSchedule(id: ID, patch: Partial<RecurringSchedule>): Promise<void> {
    await this.m("recurringUpdate", { id, patch });
  }
  async removeRecurringSchedule(id: ID): Promise<void> {
    await this.m("recurringRemove", { id });
  }

  // -- retainers -----------------------------------------------------------
  async listRetainers(status?: RetainerStatus): Promise<Retainer[]> {
    const docs = await this.q("retainersList", status ? { status } : {});
    return (docs as DbRow[]).map(toRetainer);
  }
  async listRetainersByClient(clientId: ID): Promise<Retainer[]> {
    return ((await this.q("retainersListByClient", { clientId })) as DbRow[]).map(toRetainer);
  }
  async getRetainer(id: ID): Promise<Retainer | undefined> {
    const d = (await this.q("retainersGet", { id })) as DbRow | null;
    return d ? toRetainer(d) : undefined;
  }
  async createRetainer(input: RetainerCreateInput): Promise<Retainer> {
    const d = (await this.m("retainersCreate", { id: newId("rtn"), ...input })) as DbRow;
    return toRetainer(d);
  }
  async updateRetainer(id: ID, patch: Partial<Retainer>): Promise<void> {
    await this.m("retainersUpdate", { id, patch });
  }
  async removeRetainer(id: ID): Promise<void> {
    await this.m("retainersRemove", { id });
  }

  private async extensionCall<T>(method: "query" | "mutation", operation: string, kind: string, args: Record<string, unknown> = {}): Promise<T> {
    return await this.client[method](`extensions:${operation}`, cleanArgs({ userId: await this.uid(), kind, ...args })) as T;
  }

  listMileageEntries(): Promise<MileageEntry[]> { return this.extensionCall("query", "list", "mileage"); }
  async getMileageEntry(id: ID): Promise<MileageEntry | undefined> { return (await this.extensionCall<MileageEntry | null>("query", "get", "mileage", { id })) ?? undefined; }
  createMileageEntry(input: MileageEntryCreateInput): Promise<MileageEntry> { return this.extensionCall("mutation", "create", "mileage", { id: input.id ?? newId("mil"), data: input }); }
  async updateMileageEntry(id: ID, patch: Partial<MileageEntry>): Promise<void> { await this.extensionCall("mutation", "update", "mileage", { id, patch }); }
  async removeMileageEntry(id: ID): Promise<void> { await this.extensionCall("mutation", "remove", "mileage", { id }); }

  listContracts(): Promise<Contract[]> { return this.extensionCall("query", "list", "contract"); }
  async getContract(id: ID): Promise<Contract | undefined> { return (await this.extensionCall<Contract | null>("query", "get", "contract", { id })) ?? undefined; }
  createContract(input: ContractCreateInput): Promise<Contract> { return this.extensionCall("mutation", "create", "contract", { id: input.id ?? newId("ctr"), data: input }); }
  async updateContract(id: ID, patch: Partial<Contract>): Promise<void> { await this.extensionCall("mutation", "update", "contract", { id, patch }); }
  async removeContract(id: ID): Promise<void> { await this.extensionCall("mutation", "remove", "contract", { id }); }

  listTaxPayments(): Promise<TaxPayment[]> { return this.extensionCall("query", "list", "taxPayment"); }
  async getTaxPayment(id: ID): Promise<TaxPayment | undefined> { return (await this.extensionCall<TaxPayment | null>("query", "get", "taxPayment", { id })) ?? undefined; }
  createTaxPayment(input: TaxPaymentCreateInput): Promise<TaxPayment> { return this.extensionCall("mutation", "create", "taxPayment", { id: input.id ?? newId("txp"), data: input }); }
  async updateTaxPayment(id: ID, patch: Partial<TaxPayment>): Promise<void> { await this.extensionCall("mutation", "update", "taxPayment", { id, patch }); }
  async removeTaxPayment(id: ID): Promise<void> { await this.extensionCall("mutation", "remove", "taxPayment", { id }); }

  listRateCards(): Promise<RateCard[]> { return this.extensionCall("query", "list", "rateCard"); }
  async getRateCard(id: ID): Promise<RateCard | undefined> { return (await this.extensionCall<RateCard | null>("query", "get", "rateCard", { id })) ?? undefined; }
  createRateCard(input: RateCardCreateInput): Promise<RateCard> { return this.extensionCall("mutation", "create", "rateCard", { id: input.id ?? newId("rc"), data: input }); }
  async updateRateCard(id: ID, patch: Partial<RateCard>): Promise<void> { await this.extensionCall("mutation", "update", "rateCard", { id, patch }); }
  async removeRateCard(id: ID): Promise<void> { await this.extensionCall("mutation", "remove", "rateCard", { id }); }

  // -- transactional domain workflows (atomic Convex mutations) -----------
  async assignNextInvoiceNumber(): Promise<string> {
    return (await this.m("assignInvoiceNumber")) as unknown as string;
  }
  async markInvoiceSent(invoice: Invoice): Promise<void> {
    await this.m("markInvoiceSent", { invoiceId: invoice.id });
  }
  async markInvoicePaid(invoiceId: ID): Promise<void> {
    await this.m("markInvoicePaid", { invoiceId });
  }

  // -- share links (hosted only) -------------------------------------------
  async createShareLink(input: ShareLinkCreateInput): Promise<ShareLinkRow> {
    const d = (await this.m("shareCreate", { id: newShareLinkId(), ...input })) as DbRow;
    return toShareLink(d);
  }
  async listShareLinks(): Promise<ShareLinkRow[]> {
    return ((await this.q("shareList")) as DbRow[]).map(toShareLink);
  }
  /**
   * Capability lookup for public share-token resolution. Intentionally NOT
   * user-scoped: runs only after HMAC signature verification.
   */
  async getShareLinkById(id: string): Promise<ShareLinkRow | undefined> {
    const d = await this.client.query("tally:shareGetById", { id });
    return d ? toShareLink(d as DbRow) : undefined;
  }
  async revokeShareLink(id: string): Promise<void> {
    await this.m("shareRevoke", { id });
  }
  async recordTimesheetApproval(input: TimesheetApprovalInput): Promise<TimesheetApprovalRow> {
    const d = (await this.m("approvalRecord", { id: newId("tap"), ...input })) as DbRow;
    return toApproval(d);
  }
  async listTimesheetApprovalsByLink(shareLinkId: string): Promise<TimesheetApprovalRow[]> {
    return ((await this.q("approvalsListByLink", { shareLinkId })) as DbRow[]).map(toApproval);
  }
}
