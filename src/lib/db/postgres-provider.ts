/**
 * PostgresStorageProvider — hosted-mode StorageProvider backed by Postgres
 * via Drizzle ORM.
 *
 * SERVER ONLY — never import from client components.
 *
 * PER-USER ISOLATION: every query this provider issues is scoped with
 * `user_id = <owner>`. The user id is fixed at construction (or resolved
 * lazily per call via an async resolver, so `getServerProvider()` can stay
 * synchronous while the session lookup stays request-scoped). There is no
 * code path that reads, writes, or deletes another user's rows:
 * - selects/updates/deletes always include `eq(table.userId, uid)` in the
 *   WHERE clause (combined with `and()` when additional predicates apply);
 * - inserts always write `userId: uid`;
 * - the atomic workflows (`assignNextInvoiceNumber`, `markInvoiceSent`)
 *   run inside a transaction on the same scoped connection.
 *
 * The ONLY intentionally unscoped read is `getShareLinkById`, the capability
 * lookup for public share tokens: it runs after HMAC signature verification,
 * and possession of a valid signed token IS the authorization. All data
 * loaded through a share link is then fetched with a provider scoped to the
 * link owner's userId.
 *
 * Query conditions go through the injectable `ConditionOps` (`eq`/`and`/
 * `desc`) so unit tests can verify the isolation contract without a live
 * database or the drizzle-orm package: production uses
 * `PostgresStorageProvider.create()` (dynamic-imports drizzle-orm once);
 * tests pass recording fakes. See `postgres-isolation.test.ts`.
 */
import { newId, now } from "@/core/id";
import { normalizeSettings } from "@/core/settings";
import { DEFAULT_SETTINGS } from "@/core/entities";
import { formatInvoiceNumber } from "@/core/invoice";
import { newShareLinkId } from "@/core/share";
import type { ShareLinkType } from "@/core/share";
import { sql } from "drizzle-orm";
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
import * as schema from "./postgres-schema";
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
import {
  isSyncEntityType,
  type EncryptedEntityPush,
  type EncryptedEntityRow,
  type EncryptedSyncStore,
  type SyncEntityType,
} from "./sync-store";
import type {
  ClientCreateInput,
  ExpenseCreateInput,
  InvoiceCreateInput,
  ProjectCreateInput,
  SettingsPatch,
  StorageProvider,
  TaskCreateInput,
} from "@/core/storage";

/** Condition builders — drizzle-orm's eq/and/desc/gt in production, fakes in tests. */
export interface ConditionOps {
  eq: (column: unknown, value: unknown) => unknown;
  and: (...conds: unknown[]) => unknown;
  or: (...conds: unknown[]) => unknown;
  desc: (column: unknown) => unknown;
  gt: (column: unknown, value: unknown) => unknown;
}

/** Minimal structural surface of the drizzle db this provider uses. */
export interface DbLike {
  select(...args: unknown[]): unknown;
  insert(table: unknown): unknown;
  update(table: unknown): unknown;
  delete(table: unknown): unknown;
  transaction<T>(fn: (tx: DbLike) => Promise<T>): Promise<T>;
}

// -- dynamic-db plumbing -----------------------------------------------------

/** Postgres unique-violation (pg / drizzle surface the SQLSTATE as `code`). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
/**
 * Thenable query-builder surface of the dynamic drizzle db. Terminal
 * `await` resolves to DbRow[] (see hosted-types.ts); `.returning()`
 * resolves the same way.
 */
export interface DbQueryBuilder {
  from(table: unknown): DbQueryBuilder;
  where(cond: unknown): DbQueryBuilder;
  limit(n: number): DbQueryBuilder;
  orderBy(...cols: unknown[]): DbQueryBuilder;
  for(mode: string): DbQueryBuilder;
  values(v: unknown): DbQueryBuilder;
  set(v: unknown): DbQueryBuilder;
  returning(): Promise<DbRow[]>;
  then<TResult1 = DbRow[], TResult2 = never>(
    onfulfilled?:
      | ((value: DbRow[]) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): Promise<TResult1 | TResult2>;
}

// -- row mappers -----------------------------------------------------------

function toClient(r: DbRow): Client {
  return {
    id: dbStr(r, "id"),
    name: dbStr(r, "name"),
    email: dbOptStr(r, "email"),
    address: dbOptStr(r, "address"),
    defaultRate: dbOptNum(r, "defaultRate"),
    notes: dbOptStr(r, "notes"),
    archived: Boolean(r.archived),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toProject(r: DbRow): Project {
  return {
    id: dbStr(r, "id"),
    clientId: dbStr(r, "clientId"),
    name: dbStr(r, "name"),
    rateOverride: dbOptNum(r, "rateOverride"),
    archived: Boolean(r.archived),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toTask(r: DbRow): Task {
  return {
    id: dbStr(r, "id"),
    projectId: dbStr(r, "projectId"),
    name: dbStr(r, "name"),
    startAt: dbNum(r, "startAt"),
    endAt: dbNum(r, "endAt"),
    durationMinutes: dbNum(r, "durationMinutes"),
    notes: dbOptStr(r, "notes"),
    tags: dbStrArr(r, "tags"),
    isBilled: Boolean(r.isBilled),
    invoiceId: dbOptStr(r, "invoiceId"),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toExpense(r: DbRow): Expense {
  return {
    id: dbStr(r, "id"),
    clientId: dbOptStr(r, "clientId"),
    projectId: dbOptStr(r, "projectId"),
    date: dbNum(r, "date"),
    amount: dbNum(r, "amount"),
    category: dbStr(r, "category"),
    note: dbOptStr(r, "note"),
    receiptB64: dbOptStr(r, "receiptB64"),
    isBilled: Boolean(r.isBilled),
    invoiceId: dbOptStr(r, "invoiceId"),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toInvoice(r: DbRow): Invoice {
  return {
    id: dbStr(r, "id"),
    clientId: dbStr(r, "clientId"),
    invoiceNumber: dbStr(r, "invoiceNumber"),
    issueDate: dbNum(r, "issueDate"),
    dueDate: dbNum(r, "dueDate"),
    status: dbStr(r, "status") as Invoice["status"],
    lineItems: dbJsonArr(r, "lineItems") as Invoice["lineItems"],
    subtotal: dbNum(r, "subtotal"),
    total: dbNum(r, "total"),
    notes: dbOptStr(r, "notes"),
    publicToken: dbOptStr(r, "publicToken"),
    currency: dbOptStr(r, "currency"),
    taxRegion: dbOptStr(r, "taxRegion") as Invoice["taxRegion"],
    sellerTaxId: dbOptStr(r, "sellerTaxId"),
    sellerTaxIdLabel: dbOptStr(r, "sellerTaxIdLabel"),
    buyerTaxId: dbOptStr(r, "buyerTaxId"),
    sellerEmailVisible: dbOptBool(r, "sellerEmailVisible"),
    buyerEmailVisible: dbOptBool(r, "buyerEmailVisible"),
    serviceStart: dbOptNum(r, "serviceStart"),
    serviceEnd: dbOptNum(r, "serviceEnd"),
    invoiceType: dbOptStr(r, "invoiceType"),
    paymentMethod: dbOptStr(r, "paymentMethod"),
    paymentUrl: dbOptStr(r, "paymentUrl"),
    bankAccount: dbOptStr(r, "bankAccount"),
    swiftBic: dbOptStr(r, "swiftBic"),
    qrEnabled: dbOptBool(r, "qrEnabled"),
    qrPayload: dbOptStr(r, "qrPayload"),
    qrDescription: dbOptStr(r, "qrDescription"),
    amountInWords: dbOptBool(r, "amountInWords"),
    template: dbOptStr(r, "template") as Invoice["template"],
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toRecurringSchedule(r: DbRow): RecurringSchedule {
  return {
    id: dbStr(r, "id"),
    clientId: dbStr(r, "clientId"),
    projectId: dbOptStr(r, "projectId"),
    name: dbStr(r, "name"),
    mode: dbStr(r, "mode") as RecurringSchedule["mode"],
    frequency: dbStr(r, "frequency") as RecurringSchedule["frequency"],
    interval: dbNum(r, "interval"),
    lineItems: dbJsonArr(r, "lineItems") as RecurringSchedule["lineItems"],
    startDate: dbNum(r, "startDate"),
    endDate: dbOptNum(r, "endDate"),
    maxOccurrences: dbOptNum(r, "maxOccurrences"),
    nextRunAt: dbNum(r, "nextRunAt"),
    lastRunAt: dbOptNum(r, "lastRunAt"),
    occurrences: dbNum(r, "occurrences"),
    status: dbStr(r, "status") as RecurringSchedule["status"],
    notes: dbOptStr(r, "notes"),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toRetainer(r: DbRow): Retainer {
  return {
    id: dbStr(r, "id"),
    clientId: dbStr(r, "clientId"),
    name: dbStr(r, "name"),
    type: dbStr(r, "type") as Retainer["type"],
    totalHours: dbOptNum(r, "totalHours"),
    amountCents: dbNum(r, "amountCents"),
    hourlyRate: dbOptNum(r, "hourlyRate"),
    startDate: dbNum(r, "startDate"),
    endDate: dbOptNum(r, "endDate"),
    status: dbStr(r, "status") as Retainer["status"],
    recurringScheduleId: dbOptStr(r, "recurringScheduleId"),
    notes: dbOptStr(r, "notes"),
    createdAt: dbNum(r, "createdAt"),
    updatedAt: dbNum(r, "updatedAt"),
  };
}

function toShareLink(r: DbRow): ShareLinkRow {
  return {
    id: dbStr(r, "id"),
    userId: dbStr(r, "userId"),
    type: dbStr(r, "type") as ShareLinkType,
    target: r.target,
    expiresAt: dbNum(r, "expiresAt"),
    revokedAt: (r.revokedAt as number | null | undefined) ?? null,
    createdAt: dbNum(r, "createdAt"),
  };
}

function toTimesheetApproval(r: DbRow): TimesheetApprovalRow {
  return {
    id: dbStr(r, "id"),
    userId: dbStr(r, "userId"),
    shareLinkId: dbStr(r, "shareLinkId"),
    clientId: dbStr(r, "clientId"),
    weekStartMs: dbNum(r, "weekStartMs"),
    approvedAt: dbNum(r, "approvedAt"),
    approverName: dbOptStr(r, "approverName"),
    note: dbOptStr(r, "note"),
  };
}

function toEncryptedEntity(r: DbRow): EncryptedEntityRow {
  const entityType = dbStr(r, "entityType");
  if (!isSyncEntityType(entityType)) {
    throw new Error(`Unknown encrypted entity type in database: ${entityType}`);
  }
  return {
    userId: dbStr(r, "userId"),
    entityType,
    entityId: dbStr(r, "entityId"),
    iv: dbStr(r, "iv"),
    ciphertext: dbStr(r, "ciphertext"),
    updatedAt: dbNum(r, "updatedAt"),
    deleted: Boolean(r.deleted),
  };
}

/** A pushed snapshot is structurally valid (the payload is opaque ciphertext). */
function isValidPush(item: unknown): item is EncryptedEntityPush {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  return (
    isSyncEntityType(r.entityType) &&
    typeof r.entityId === "string" &&
    r.entityId.length > 0 &&
    typeof r.iv === "string" &&
    r.iv.length > 0 &&
    typeof r.ciphertext === "string" &&
    r.ciphertext.length > 0 &&
    typeof r.updatedAt === "number" &&
    Number.isFinite(r.updatedAt) &&
    typeof r.deleted === "boolean"
  );
}

// -- provider --------------------------------------------------------------

export class PostgresStorageProvider implements StorageProvider, EncryptedSyncStore {
  readonly providerName: string = "postgres";

  /**
   * Production factory: loads drizzle-orm's condition builders once via
   * dynamic import (kept out of the static import graph so unit tests and
   * non-postgres bundles never require the package).
   */
  static async create(
    db: DbLike,
    userId: UserIdSource,
  ): Promise<PostgresStorageProvider> {
    const { eq, and, or, desc, gt } = (await import("drizzle-orm")) as unknown as {
      eq: ConditionOps["eq"];
      and: ConditionOps["and"];
      or: ConditionOps["or"];
      desc: ConditionOps["desc"];
      gt: ConditionOps["gt"];
    };
    return new PostgresStorageProvider(db, userId, { eq, and, or, desc, gt });
  }

  constructor(
    private readonly db: DbLike,
    private readonly userIdSource: UserIdSource,
    private readonly ops: ConditionOps,
  ) {}

  private async uid(): Promise<string> {
    return typeof this.userIdSource === "string"
      ? this.userIdSource
      : this.userIdSource();
  }

  /** `user_id = uid`, optionally ANDed with extra predicates. */
  private scope(table: { userId: unknown }, uid: string, ...extra: unknown[]) {
    const base = this.ops.eq(table.userId, uid);
    return extra.length > 0 ? this.ops.and(base, ...extra) : base;
  }

  private scopedById(
    table: { userId: unknown; id: unknown },
    uid: string,
    id: ID,
  ) {
    return this.scope(table, uid, this.ops.eq(table.id, id));
  }

  // -- clients -----------------------------------------------------------
  async listClients(includeArchived = false): Promise<Client[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.clients)
      .where(this.scope(schema.clients, uid));
    const all = rows.map(toClient);
    const filtered = includeArchived ? all : all.filter((c) => !c.archived);
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getClient(id: ID): Promise<Client | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.clients)
      .where(this.scopedById(schema.clients, uid, id))
      .limit(1);
    return rows[0] ? toClient(rows[0]) : undefined;
  }

  async createClient(input: ClientCreateInput): Promise<Client> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.clients) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("cli"),
        userId: uid,
        name: input.name,
        email: input.email,
        address: input.address,
        defaultRate: input.defaultRate,
        notes: input.notes,
        archived: input.archived ?? false,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toClient(rows[0]);
  }

  async updateClient(id: ID, patch: Partial<Client>): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.clients) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.clients, uid, id));
  }

  async removeClient(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.clients) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.clients, uid, id),
    );
  }

  // -- projects ----------------------------------------------------------
  async listProjects(): Promise<Project[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.projects)
      .where(this.scope(schema.projects, uid));
    return rows.map(toProject);
  }

  async listProjectsByClient(clientId: ID): Promise<Project[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.projects)
      .where(
        this.scope(schema.projects, uid, this.ops.eq(schema.projects.clientId, clientId)),
      );
    return rows.map(toProject);
  }

  async getProject(id: ID): Promise<Project | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.projects)
      .where(this.scopedById(schema.projects, uid, id))
      .limit(1);
    return rows[0] ? toProject(rows[0]) : undefined;
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.projects) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("prj"),
        userId: uid,
        clientId: input.clientId,
        name: input.name,
        rateOverride: input.rateOverride,
        archived: input.archived ?? false,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toProject(rows[0]);
  }

  async updateProject(id: ID, patch: Partial<Project>): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.projects) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.projects, uid, id));
  }

  async removeProject(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.projects) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.projects, uid, id),
    );
  }

  // -- tasks -------------------------------------------------------------
  async listTasks(): Promise<Task[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.tasks)
      .where(this.scope(schema.tasks, uid))
      .orderBy(this.ops.desc(schema.tasks.startAt));
    return rows.map(toTask);
  }

  async getTask(id: ID): Promise<Task | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.tasks)
      .where(this.scopedById(schema.tasks, uid, id))
      .limit(1);
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async listTasksByProject(projectId: ID): Promise<Task[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.tasks)
      .where(
        this.scope(schema.tasks, uid, this.ops.eq(schema.tasks.projectId, projectId)),
      );
    return rows.map(toTask);
  }

  async listUnbilledTasks(): Promise<Task[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.tasks)
      .where(
        this.scope(schema.tasks, uid, this.ops.eq(schema.tasks.isBilled, false)),
      );
    return rows.map(toTask);
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const uid = await this.uid();
    const ts = now();
    const durationMinutes =
      input.durationMinutes ??
      Math.max(0, Math.round((input.endAt - input.startAt) / 60000));
    const rows = await (this.db.insert(schema.tasks) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("tsk"),
        userId: uid,
        projectId: input.projectId,
        name: input.name,
        startAt: input.startAt,
        endAt: input.endAt,
        durationMinutes,
        notes: input.notes,
        tags: input.tags ?? [],
        isBilled: input.isBilled ?? false,
        invoiceId: input.invoiceId,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toTask(rows[0]);
  }

  async updateTask(id: ID, patch: Partial<Task>): Promise<void> {
    const uid = await this.uid();
    const next: Record<string, unknown> = {
      ...patch,
      updatedAt: patch.updatedAt ?? now(),
    };
    delete next.id;
    delete next.createdAt; // created_at is immutable — never rewrite it
    if (patch.startAt != null || patch.endAt != null) {
      const existing = await this.getTask(id);
      if (existing) {
        const startAt = (patch.startAt ?? existing.startAt) as number;
        const endAt = (patch.endAt ?? existing.endAt) as number;
        next.durationMinutes = Math.max(0, Math.round((endAt - startAt) / 60000));
      }
    }
    await (this.db.update(schema.tasks) as unknown as DbQueryBuilder)
      .set(next)
      .where(this.scopedById(schema.tasks, uid, id));
  }

  async removeTask(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.tasks) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.tasks, uid, id),
    );
  }

  // -- expenses ----------------------------------------------------------
  async listExpenses(): Promise<Expense[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.expenses)
      .where(this.scope(schema.expenses, uid))
      .orderBy(this.ops.desc(schema.expenses.date));
    return rows.map(toExpense);
  }

  async getExpense(id: ID): Promise<Expense | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.expenses)
      .where(this.scopedById(schema.expenses, uid, id))
      .limit(1);
    return rows[0] ? toExpense(rows[0]) : undefined;
  }

  async createExpense(input: ExpenseCreateInput): Promise<Expense> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.expenses) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("exp"),
        userId: uid,
        clientId: input.clientId,
        projectId: input.projectId,
        date: input.date,
        amount: input.amount,
        category: input.category,
        note: input.note,
        receiptB64: input.receiptB64,
        isBilled: input.isBilled ?? false,
        invoiceId: input.invoiceId,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toExpense(rows[0]);
  }

  async updateExpense(id: ID, patch: Partial<Expense>): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.expenses) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.expenses, uid, id));
  }

  async removeExpense(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.expenses) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.expenses, uid, id),
    );
  }

  // -- invoices ----------------------------------------------------------
  async listInvoices(): Promise<Invoice[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.invoices)
      .where(this.scope(schema.invoices, uid))
      .orderBy(this.ops.desc(schema.invoices.issueDate));
    return rows.map(toInvoice);
  }

  async getInvoice(id: ID): Promise<Invoice | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.invoices)
      .where(this.scopedById(schema.invoices, uid, id))
      .limit(1);
    return rows[0] ? toInvoice(rows[0]) : undefined;
  }

  async getInvoiceByPublicToken(token: string): Promise<Invoice | undefined> {
    if (!token) return undefined;
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.invoices)
      .where(
        this.scope(schema.invoices, uid, this.ops.eq(schema.invoices.publicToken, token)),
      )
      .limit(1);
    return rows[0] ? toInvoice(rows[0]) : undefined;
  }

  async createInvoice(input: InvoiceCreateInput): Promise<Invoice> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.invoices) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("inv"),
        userId: uid,
        clientId: input.clientId,
        invoiceNumber: input.invoiceNumber,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        status: input.status,
        lineItems: input.lineItems,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes,
        publicToken: input.publicToken,
        currency: input.currency,
        taxRegion: input.taxRegion,
        sellerTaxId: input.sellerTaxId,
        sellerTaxIdLabel: input.sellerTaxIdLabel,
        buyerTaxId: input.buyerTaxId,
        sellerEmailVisible: input.sellerEmailVisible,
        buyerEmailVisible: input.buyerEmailVisible,
        serviceStart: input.serviceStart,
        serviceEnd: input.serviceEnd,
        invoiceType: input.invoiceType,
        paymentMethod: input.paymentMethod,
        paymentUrl: input.paymentUrl,
        bankAccount: input.bankAccount,
        swiftBic: input.swiftBic,
        qrEnabled: input.qrEnabled,
        qrPayload: input.qrPayload,
        qrDescription: input.qrDescription,
        amountInWords: input.amountInWords,
        template: input.template,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toInvoice(rows[0]);
  }

  async updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.invoices) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.invoices, uid, id));
  }

  async removeInvoice(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.invoices) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.invoices, uid, id),
    );
  }

  // -- settings ----------------------------------------------------------
  async readSettings(): Promise<Settings | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.settings)
      .where(this.ops.eq(schema.settings.userId, uid))
      .limit(1);
    if (!rows[0]) return undefined;
    return normalizeSettings(parseSettingsData(rows[0].data));
  }

  async getSettings(): Promise<Settings> {
    const existing = await this.readSettings();
    if (existing) {
      const merged = normalizeSettings(existing);
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        await this.writeSettingsRow(merged);
      }
      return merged;
    }
    await this.writeSettingsRow({ ...DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }

  private async writeSettingsRow(settings: Settings): Promise<void> {
    const uid = await this.uid();
    const data = JSON.stringify(settings);
    // Upsert by user_id (primary key).
    const existing = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.settings)
      .where(this.ops.eq(schema.settings.userId, uid))
      .limit(1);
    if (existing[0]) {
      await (this.db.update(schema.settings) as unknown as DbQueryBuilder)
        .set({ data })
        .where(this.ops.eq(schema.settings.userId, uid));
    } else {
      await (this.db.insert(schema.settings) as unknown as DbQueryBuilder).values({ userId: uid, data });
    }
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const current = await this.getSettings();
    const next = normalizeSettings({
      ...current,
      ...patch,
      id: "singleton",
      business: { ...current.business, ...patch.business },
      invoice: { ...current.invoice, ...patch.invoice },
      reckoning: { ...current.reckoning, ...(patch.reckoning ?? {}) },
      appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
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
    await this.writeSettingsRow(next);
    return next;
  }

  // -- recurring schedules ------------------------------------------------
  async listRecurringSchedules(status?: RecurringStatus): Promise<RecurringSchedule[]> {
    const uid = await this.uid();
    const cond =
      status == null
        ? this.scope(schema.recurringSchedules, uid)
        : this.scope(
            schema.recurringSchedules,
            uid,
            this.ops.eq(schema.recurringSchedules.status, status),
          );
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.recurringSchedules)
      .where(cond);
    return rows
      .map(toRecurringSchedule)
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  async listRecurringSchedulesByClient(clientId: ID): Promise<RecurringSchedule[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.recurringSchedules)
      .where(
        this.scope(
          schema.recurringSchedules,
          uid,
          this.ops.eq(schema.recurringSchedules.clientId, clientId),
        ),
      );
    return rows
      .map(toRecurringSchedule)
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  async getRecurringSchedule(id: ID): Promise<RecurringSchedule | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.recurringSchedules)
      .where(this.scopedById(schema.recurringSchedules, uid, id))
      .limit(1);
    return rows[0] ? toRecurringSchedule(rows[0]) : undefined;
  }

  async createRecurringSchedule(
    input: RecurringScheduleCreateInput,
  ): Promise<RecurringSchedule> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.recurringSchedules) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("rsd"),
        userId: uid,
        clientId: input.clientId,
        projectId: input.projectId,
        name: input.name,
        mode: input.mode,
        frequency: input.frequency,
        interval: input.interval,
        lineItems: input.lineItems,
        startDate: input.startDate,
        endDate: input.endDate,
        maxOccurrences: input.maxOccurrences,
        // Mirror writes adopt the browser's run cursor wholesale.
        nextRunAt: input.nextRunAt ?? input.startDate,
        ...(input.lastRunAt != null ? { lastRunAt: input.lastRunAt } : {}),
        occurrences: input.occurrences ?? 0,
        status: input.status ?? "active",
        notes: input.notes,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toRecurringSchedule(rows[0]);
  }

  async updateRecurringSchedule(
    id: ID,
    patch: Partial<RecurringSchedule>,
  ): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.recurringSchedules) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.recurringSchedules, uid, id));
  }

  async removeRecurringSchedule(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.recurringSchedules) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.recurringSchedules, uid, id),
    );
  }

  // -- retainers -----------------------------------------------------------
  async listRetainers(status?: RetainerStatus): Promise<Retainer[]> {
    const uid = await this.uid();
    const cond =
      status == null
        ? this.scope(schema.retainers, uid)
        : this.scope(schema.retainers, uid, this.ops.eq(schema.retainers.status, status));
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.retainers)
      .where(cond);
    return rows.map(toRetainer).sort((a, b) => b.startDate - a.startDate);
  }

  async listRetainersByClient(clientId: ID): Promise<Retainer[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.retainers)
      .where(
        this.scope(schema.retainers, uid, this.ops.eq(schema.retainers.clientId, clientId)),
      );
    return rows.map(toRetainer).sort((a, b) => b.startDate - a.startDate);
  }

  async getRetainer(id: ID): Promise<Retainer | undefined> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.retainers)
      .where(this.scopedById(schema.retainers, uid, id))
      .limit(1);
    return rows[0] ? toRetainer(rows[0]) : undefined;
  }

  async createRetainer(input: RetainerCreateInput): Promise<Retainer> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.retainers) as unknown as DbQueryBuilder)
      .values({
        id: input.id ?? newId("rtn"),
        userId: uid,
        clientId: input.clientId,
        name: input.name,
        type: input.type,
        totalHours: input.totalHours,
        amountCents: input.amountCents,
        hourlyRate: input.hourlyRate,
        startDate: input.startDate,
        endDate: input.endDate,
        status: input.status ?? "active",
        recurringScheduleId: input.recurringScheduleId,
        notes: input.notes,
        createdAt: input.createdAt ?? ts,
        updatedAt: input.updatedAt ?? ts,
      })
      .returning();
    return toRetainer(rows[0]);
  }

  async updateRetainer(id: ID, patch: Partial<Retainer>): Promise<void> {
    const uid = await this.uid();
    const rest = { ...patch } as Record<string, unknown>;
    delete rest.id;
    delete rest.createdAt; // created_at is immutable — never rewrite it
    await (this.db.update(schema.retainers) as unknown as DbQueryBuilder)
      .set({ ...rest, updatedAt: patch.updatedAt ?? now() })
      .where(this.scopedById(schema.retainers, uid, id));
  }

  async removeRetainer(id: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.delete(schema.retainers) as unknown as DbQueryBuilder).where(
      this.scopedById(schema.retainers, uid, id),
    );
  }

  // -- transactional domain workflows (atomic) ---------------------------
  async assignNextInvoiceNumber(): Promise<string> {
    const uid = await this.uid();
    return this.db.transaction(async (tx) => {
      const txx = tx as DbLike;
      const rows = (await (txx.select() as unknown as DbQueryBuilder)
        .from(schema.settings)
        .where(this.ops.eq(schema.settings.userId, uid))
        .limit(1)
        // Row lock so concurrent callers never receive the same number.
        .for("update"));
      const current: Settings = rows[0]?.data
        ? normalizeSettings(parseSettingsData(rows[0].data))
        : { ...DEFAULT_SETTINGS };
      const { numberPrefix, nextNumber } = current.invoice;
      const result = formatInvoiceNumber(numberPrefix, nextNumber);
      const updated: Settings = {
        ...current,
        invoice: { ...current.invoice, nextNumber: nextNumber + 1 },
      };
      await this.writeSettingsRowTx(txx, uid, updated);
      return result;
    });
  }

  private async writeSettingsRowTx(
    tx: DbLike,
    uid: string,
    settings: Settings,
  ): Promise<void> {
    const data = JSON.stringify(settings);
    const existing = (await ((tx.select() as unknown as DbQueryBuilder)
      .from(schema.settings)
      .where(this.ops.eq(schema.settings.userId, uid))
      .limit(1)));
    if (existing[0]) {
      await ((tx.update(schema.settings) as unknown as DbQueryBuilder)
        .set({ data })
        .where(this.ops.eq(schema.settings.userId, uid)));
    } else {
      await ((tx.insert(schema.settings) as unknown as DbQueryBuilder).values({ userId: uid, data }));
    }
  }

  async markInvoiceSent(invoice: Invoice): Promise<void> {
    const uid = await this.uid();
    const taskIds = invoice.lineItems
      .filter((l) => l.sourceType === "task" && l.sourceId)
      .map((l) => l.sourceId as string);
    const expenseIds = invoice.lineItems
      .filter((l) => l.sourceType === "expense" && l.sourceId)
      .map((l) => l.sourceId as string);
    const ts = Date.now();
    await this.db.transaction(async (tx) => {
      const txx = tx as DbLike;
      await ((txx.update(schema.invoices) as unknown as DbQueryBuilder)
        .set({ status: "sent", updatedAt: ts })
        .where(this.scopedById(schema.invoices, uid, invoice.id)));
      for (const tid of taskIds) {
        await ((txx.update(schema.tasks) as unknown as DbQueryBuilder)
          .set({ isBilled: true, invoiceId: invoice.id, updatedAt: ts })
          .where(this.scopedById(schema.tasks, uid, tid)));
      }
      for (const eid of expenseIds) {
        await ((txx.update(schema.expenses) as unknown as DbQueryBuilder)
          .set({ isBilled: true, invoiceId: invoice.id, updatedAt: ts })
          .where(this.scopedById(schema.expenses, uid, eid)));
      }
    });
  }

  async markInvoicePaid(invoiceId: ID): Promise<void> {
    const uid = await this.uid();
    await (this.db.update(schema.invoices) as unknown as DbQueryBuilder)
      .set({ status: "paid", updatedAt: Date.now() })
      .where(this.scopedById(schema.invoices, uid, invoiceId));
  }

  // -- share links (hosted only; scoped like everything else) --------------
  async createShareLink(input: ShareLinkCreateInput): Promise<ShareLinkRow> {
    const uid = await this.uid();
    const ts = now();
    const rows = await (this.db.insert(schema.shareLinks) as unknown as DbQueryBuilder)
      .values({
        id: newShareLinkId(),
        userId: uid,
        type: input.type,
        target: input.target,
        expiresAt: input.expiresAt,
        createdAt: ts,
      })
      .returning();
    return toShareLink(rows[0]);
  }

  async listShareLinks(): Promise<ShareLinkRow[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.shareLinks)
      .where(this.scope(schema.shareLinks, uid))
      .orderBy(this.ops.desc(schema.shareLinks.createdAt));
    return rows.map(toShareLink);
  }

  /**
   * Capability lookup for public share-token resolution. Intentionally NOT
   * user-scoped: it runs only after HMAC signature verification, and the
   * signed token itself is the authorization. Revocation/expiry are enforced
   * by the caller. All data fetched through the link afterwards uses a
   * provider scoped to `row.userId`.
   */
  async getShareLinkById(id: string): Promise<ShareLinkRow | undefined> {
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.shareLinks)
      .where(this.ops.eq(schema.shareLinks.id, id))
      .limit(1);
    return rows[0] ? toShareLink(rows[0]) : undefined;
  }

  async revokeShareLink(id: string): Promise<void> {
    const uid = await this.uid();
    await (this.db.update(schema.shareLinks) as unknown as DbQueryBuilder)
      .set({ revokedAt: now() })
      .where(this.scopedById(schema.shareLinks, uid, id));
  }

  async recordTimesheetApproval(
    input: TimesheetApprovalInput,
  ): Promise<TimesheetApprovalRow> {
    const uid = await this.uid();
    const row = {
      id: newId("tap"),
      userId: uid,
      shareLinkId: input.shareLinkId,
      clientId: input.clientId,
      weekStartMs: input.weekStartMs,
      approvedAt: now(),
      approverName: input.approverName,
      note: input.note,
    };
    try {
      const rows = await (
        this.db.insert(schema.timesheetApprovals) as unknown as DbQueryBuilder
      )
        .values(row)
        .returning();
      return toTimesheetApproval(rows[0]);
    } catch (err) {
      // Lost the insert race: the unique (user, link, week) index fired.
      // Return the winner's row so a double-submit stays idempotent.
      if (!isUniqueViolation(err)) throw err;
      const existing = await (
        this.db.select() as unknown as DbQueryBuilder
      )
        .from(schema.timesheetApprovals)
        .where(
          this.ops.and(
            this.ops.eq(schema.timesheetApprovals.userId, uid),
            this.ops.eq(schema.timesheetApprovals.shareLinkId, input.shareLinkId),
            this.ops.eq(schema.timesheetApprovals.weekStartMs, input.weekStartMs),
          ),
        )
        .limit(1);
      if (!existing[0]) throw err;
      return toTimesheetApproval(existing[0]);
    }
  }

  async listTimesheetApprovalsByLink(
    shareLinkId: string,
  ): Promise<TimesheetApprovalRow[]> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.timesheetApprovals)
      .where(
        this.scope(
          schema.timesheetApprovals,
          uid,
          this.ops.eq(schema.timesheetApprovals.shareLinkId, shareLinkId),
        ),
      );
    return rows.map(toTimesheetApproval);
  }

  // -- encrypted sync vault (E2E: server stores ciphertext only) -----------
  //
  // `iv`/`ciphertext` are opaque to the server — validation here is purely
  // structural (known entity type, non-empty strings, finite updatedAt).
  // Last-write-wins compares the client-supplied `updatedAt`: a snapshot is
  // written only when strictly newer than the stored one.

  async upsertEncryptedEntities(items: EncryptedEntityPush[]): Promise<number> {
    const uid = await this.uid();
    const valid = items.filter(isValidPush);
    if (valid.length === 0) return 0;
    // Fast path: skip items that are already stale vs. what's stored. The
    // INSERT below re-checks atomically, so this map is only an optimization.
    const existing = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.encryptedEntities)
      .where(this.scope(schema.encryptedEntities, uid));
    const prevByKey = new Map(
      existing.map((r) => [
        `${dbStr(r, "entityType")}/${dbStr(r, "entityId")}`,
        dbNum(r, "updatedAt"),
      ]),
    );
    let written = 0;
    for (const item of valid) {
      const prev = prevByKey.get(`${item.entityType}/${item.entityId}`);
      if (prev !== undefined && prev >= item.updatedAt) continue; // LWW: stored wins
      // Atomic LWW upsert: a concurrent stale writer can never overwrite
      // newer ciphertext — the DO UPDATE only fires when the incoming
      // updatedAt is strictly newer than the stored one. Works on both the
      // node-pg and the Neon HTTP drivers (builder-level SQL, no
      // interactive transaction needed).
      await (
        this.db.insert(schema.encryptedEntities) as unknown as {
          values(v: unknown): {
            onConflictDoUpdate(c: unknown): Promise<unknown>;
          };
        }
      )
        .values({ userId: uid, ...item })
        .onConflictDoUpdate({
          target: [
            schema.encryptedEntities.userId,
            schema.encryptedEntities.entityType,
            schema.encryptedEntities.entityId,
          ],
          set: {
            iv: item.iv,
            ciphertext: item.ciphertext,
            updatedAt: item.updatedAt,
            deleted: item.deleted,
          },
          setWhere: sql`${schema.encryptedEntities.updatedAt} < ${item.updatedAt}`,
        });
      written++;
    }
    return written;
  }

  async listEncryptedEntitiesSince(
    since: number,
    entityTypes?: SyncEntityType[],
    limit?: number,
    after?: { updatedAt: number; entityId: string },
  ): Promise<EncryptedEntityRow[]> {
    const uid = await this.uid();
    // Keyset pagination on (updated_at, entity_id): `after` is the last row
    // of the previous page. This makes paging exact even when thousands of
    // rows share one timestamp — plain `updated_at > since` + LIMIT would
    // loop forever or skip rows at a timestamp collision on the page
    // boundary. entity_id is globally unique, so the pair is a total order.
    const cursor = after
      ? this.ops.or(
          this.ops.gt(schema.encryptedEntities.updatedAt, after.updatedAt),
          this.ops.and(
            this.ops.eq(schema.encryptedEntities.updatedAt, after.updatedAt),
            this.ops.gt(schema.encryptedEntities.entityId, after.entityId),
          ),
        )
      : this.ops.gt(schema.encryptedEntities.updatedAt, since);
    let q = (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.encryptedEntities)
      .where(
        this.ops.and(this.ops.eq(schema.encryptedEntities.userId, uid), cursor),
      )
      .orderBy(
        schema.encryptedEntities.updatedAt,
        schema.encryptedEntities.entityId,
      );
    if (limit !== undefined) q = q.limit(limit);
    const rows = await q;
    const all = rows.map(toEncryptedEntity);
    const wanted =
      entityTypes && entityTypes.length > 0
        ? new Set<SyncEntityType>(entityTypes.filter(isSyncEntityType))
        : null;
    return wanted ? all.filter((r) => wanted.has(r.entityType)) : all;
  }

  async countEncryptedEntities(): Promise<number> {
    const uid = await this.uid();
    const rows = await (this.db.select() as unknown as DbQueryBuilder)
      .from(schema.encryptedEntities)
      .where(this.scope(schema.encryptedEntities, uid));
    return rows.length;
  }
}

function parseSettingsData(data: unknown): Settings {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  if (data && typeof data === "object") return data as Settings;
  return { ...DEFAULT_SETTINGS };
}
