/**
 * Convex functions for hosted mode (`TALLY_STORAGE=convex`).
 *
 * One function per CRUD operation, mirroring the StorageProvider contract.
 * EVERY function takes `userId` and scopes by it — the Convex provider
 * passes the authenticated user on every call, and the functions re-check
 * (defense in depth). Called by `ConvexStorageProvider` via string paths
 * like `"tally:clientsList"` (no codegen import needed on the Next.js side).
 *
 * Note: Convex args cannot contain `undefined` — the provider strips
 * undefined values before calling (see `convex-provider.ts`).
 */
import {
  mutationGeneric,
  queryGeneric,
  type GenericDatabaseReader,
  type GenericDatabaseWriter,
} from "convex/server";
import { v } from "convex/values";
import { DEFAULT_SETTINGS } from "../src/core/entities";
import { normalizeSettings } from "../src/core/settings";
import { formatInvoiceNumber } from "../src/core/invoice";

/** Normalize persisted settings the same way the Dexie provider does. */
function normalize(data: unknown) {
  return normalizeSettings(
    (data && typeof data === "object" ? data : { ...DEFAULT_SETTINGS }) as never,
  );
}

/**
 * Minimal structural view of the Convex function context. We don't run
 * Convex codegen in this repo (functions deploy from `convex/` as-is), so
 * instead of generated types we declare just the db surface this file uses.
 */
/**
 * Real Convex function-context types (no codegen in this repo).
 * `any` DataModel keeps the functions deployable as-is; per-function arg
 * validators (v.string() etc.) still enforce shapes at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReadCtx = { db: GenericDatabaseReader<any> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriteCtx = { db: GenericDatabaseWriter<any> };

function needUser(userId: string): string {
  if (!userId) throw new Error("userId is required");
  return userId;
}

async function docById(ctx: ReadCtx, table: string, userId: string, id: string) {
  return await ctx.db
    .query(table)
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("id"), id))
    .unique();
}

async function removeDoc(ctx: WriteCtx, table: string, userId: string, id: string) {
  const doc = await docById(ctx, table, userId, id);
  if (doc) await ctx.db.delete(doc._id);
  return { removed: Boolean(doc) };
}

async function patchDoc(
  ctx: WriteCtx,
  table: string,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const doc = await docById(ctx, table, userId, id);
  if (!doc) throw new Error(`${table}/${id} not found`);
  const clean: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [k, val] of Object.entries(patch)) {
    if (k === "id" || k === "_id" || k === "userId") continue;
    clean[k] = val;
  }
  await ctx.db.patch(doc._id, clean);
  return { updated: true };
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export const clientsList = queryGeneric({
  args: { userId: v.string(), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const docs = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const filtered = args.includeArchived ? docs : docs.filter((d) => !d.archived);
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const clientsGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "clients", needUser(args.userId), args.id),
});

export const clientsCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    defaultRate: v.optional(v.number()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      name: args.name,
      ...(args.email !== undefined ? { email: args.email } : {}),
      ...(args.address !== undefined ? { address: args.address } : {}),
      ...(args.defaultRate !== undefined ? { defaultRate: args.defaultRate } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      archived: args.archived ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("clients", doc);
    return doc;
  },
});

export const clientsUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "clients", needUser(args.userId), args.id, args.patch),
});

export const clientsRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "clients", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projectsList = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect(),
});

export const projectsListByClient = queryGeneric({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    return ctx.db
      .query("projects")
      .withIndex("by_user_client", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("clientId"), args.clientId))
      .collect();
  },
});

export const projectsGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "projects", needUser(args.userId), args.id),
});

export const projectsCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    clientId: v.string(),
    name: v.string(),
    rateOverride: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      clientId: args.clientId,
      name: args.name,
      ...(args.rateOverride !== undefined ? { rateOverride: args.rateOverride } : {}),
      archived: args.archived ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("projects", doc);
    return doc;
  },
});

export const projectsUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "projects", needUser(args.userId), args.id, args.patch),
});

export const projectsRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "projects", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

export const tasksList = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    return docs.sort((a, b) => b.startAt - a.startAt);
  },
});

export const tasksGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "tasks", needUser(args.userId), args.id),
});

export const tasksListByProject = queryGeneric({
  args: { userId: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    return ctx.db
      .query("tasks")
      .withIndex("by_user_project", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .collect();
  },
});

export const tasksListUnbilled = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    return docs.filter((d) => !d.isBilled);
  },
});

export const tasksCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    projectId: v.string(),
    name: v.string(),
    startAt: v.number(),
    endAt: v.number(),
    durationMinutes: v.number(),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
    isBilled: v.optional(v.boolean()),
    invoiceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      projectId: args.projectId,
      name: args.name,
      startAt: args.startAt,
      endAt: args.endAt,
      durationMinutes: args.durationMinutes,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      tags: args.tags,
      isBilled: args.isBilled ?? false,
      ...(args.invoiceId !== undefined ? { invoiceId: args.invoiceId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("tasks", doc);
    return doc;
  },
});

export const tasksUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "tasks", needUser(args.userId), args.id, args.patch),
});

export const tasksRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "tasks", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------

export const expensesList = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("expenses")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    return docs.sort((a, b) => b.date - a.date);
  },
});

export const expensesGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "expenses", needUser(args.userId), args.id),
});

export const expensesCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    clientId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    date: v.number(),
    amount: v.number(),
    category: v.string(),
    note: v.optional(v.string()),
    receiptB64: v.optional(v.string()),
    receiptKey: v.optional(v.string()),
    isBilled: v.optional(v.boolean()),
    invoiceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      ...(args.clientId !== undefined ? { clientId: args.clientId } : {}),
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      date: args.date,
      amount: args.amount,
      category: args.category,
      ...(args.note !== undefined ? { note: args.note } : {}),
      ...(args.receiptB64 !== undefined ? { receiptB64: args.receiptB64 } : {}),
      ...(args.receiptKey !== undefined ? { receiptKey: args.receiptKey } : {}),
      isBilled: args.isBilled ?? false,
      ...(args.invoiceId !== undefined ? { invoiceId: args.invoiceId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("expenses", doc);
    return doc;
  },
});

export const expensesUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "expenses", needUser(args.userId), args.id, args.patch),
});

export const expensesRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "expenses", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// invoices
// ---------------------------------------------------------------------------

export const invoicesList = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    return docs.sort((a, b) => b.issueDate - a.issueDate);
  },
});

export const invoicesGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "invoices", needUser(args.userId), args.id),
});

export const invoicesGetByPublicToken = queryGeneric({
  args: { userId: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const userId = needUser(args.userId);
    return await ctx.db
      .query("invoices")
      .withIndex("by_user_publicToken", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("publicToken"), args.token))
      .unique();
  },
});

export const invoicesCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    clientId: v.string(),
    invoiceNumber: v.string(),
    issueDate: v.number(),
    dueDate: v.number(),
    status: v.string(),
    lineItems: v.any(),
    subtotal: v.number(),
    total: v.number(),
    notes: v.optional(v.string()),
    publicToken: v.optional(v.string()),
    currency: v.optional(v.string()),
    taxRegion: v.optional(v.string()),
    sellerTaxId: v.optional(v.string()),
    sellerTaxIdLabel: v.optional(v.string()),
    buyerTaxId: v.optional(v.string()),
    sellerEmailVisible: v.optional(v.boolean()),
    buyerEmailVisible: v.optional(v.boolean()),
    serviceStart: v.optional(v.number()),
    serviceEnd: v.optional(v.number()),
    invoiceType: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    paymentUrl: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    swiftBic: v.optional(v.string()),
    qrEnabled: v.optional(v.boolean()),
    qrPayload: v.optional(v.string()),
    qrDescription: v.optional(v.string()),
    amountInWords: v.optional(v.boolean()),
    template: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      clientId: args.clientId,
      invoiceNumber: args.invoiceNumber,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: args.status,
      lineItems: args.lineItems,
      subtotal: args.subtotal,
      total: args.total,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.publicToken !== undefined ? { publicToken: args.publicToken } : {}),
      ...(args.currency !== undefined ? { currency: args.currency } : {}),
      ...(args.taxRegion !== undefined ? { taxRegion: args.taxRegion } : {}),
      ...(args.sellerTaxId !== undefined ? { sellerTaxId: args.sellerTaxId } : {}),
      ...(args.sellerTaxIdLabel !== undefined ? { sellerTaxIdLabel: args.sellerTaxIdLabel } : {}),
      ...(args.buyerTaxId !== undefined ? { buyerTaxId: args.buyerTaxId } : {}),
      ...(args.sellerEmailVisible !== undefined ? { sellerEmailVisible: args.sellerEmailVisible } : {}),
      ...(args.buyerEmailVisible !== undefined ? { buyerEmailVisible: args.buyerEmailVisible } : {}),
      ...(args.serviceStart !== undefined ? { serviceStart: args.serviceStart } : {}),
      ...(args.serviceEnd !== undefined ? { serviceEnd: args.serviceEnd } : {}),
      ...(args.invoiceType !== undefined ? { invoiceType: args.invoiceType } : {}),
      ...(args.paymentMethod !== undefined ? { paymentMethod: args.paymentMethod } : {}),
      ...(args.paymentUrl !== undefined ? { paymentUrl: args.paymentUrl } : {}),
      ...(args.bankAccount !== undefined ? { bankAccount: args.bankAccount } : {}),
      ...(args.swiftBic !== undefined ? { swiftBic: args.swiftBic } : {}),
      ...(args.qrEnabled !== undefined ? { qrEnabled: args.qrEnabled } : {}),
      ...(args.qrPayload !== undefined ? { qrPayload: args.qrPayload } : {}),
      ...(args.qrDescription !== undefined ? { qrDescription: args.qrDescription } : {}),
      ...(args.amountInWords !== undefined ? { amountInWords: args.amountInWords } : {}),
      ...(args.template !== undefined ? { template: args.template } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("invoices", doc);
    return doc;
  },
});

export const invoicesUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "invoices", needUser(args.userId), args.id, args.patch),
});

export const invoicesRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "invoices", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// settings (one doc per user; read-or-initialize + deep-merge patch)
// ---------------------------------------------------------------------------

export const settingsRead = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .unique();
    return doc ? normalize(doc.data) : null;
  },
});

export const settingsGet = mutationGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      const merged = normalize(existing.data);
      if (JSON.stringify(merged) !== JSON.stringify(normalize(existing.data))) {
        await ctx.db.patch(existing._id, { data: merged });
      }
      return merged;
    }
    const fresh = { ...DEFAULT_SETTINGS };
    await ctx.db.insert("settings", { userId, data: fresh });
    return fresh;
  },
});

export const settingsUpdate = mutationGeneric({
  args: { userId: v.string(), patch: v.any() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const current = existing ? normalize(existing.data) : { ...DEFAULT_SETTINGS };
    const p = (args.patch ?? {}) as Record<string, unknown>;
    const next = normalize({
      ...current,
      ...p,
      id: "singleton",
      business: { ...current.business, ...(p.business ?? {}) },
      invoice: { ...current.invoice, ...(p.invoice ?? {}) },
      reckoning: { ...current.reckoning, ...(p.reckoning ?? {}) },
      appearance: { ...current.appearance, ...(p.appearance ?? {}) },
      expenseCategories: p.expenseCategories ?? current.expenseCategories,
    });
    if (existing) await ctx.db.patch(existing._id, { data: next });
    else await ctx.db.insert("settings", { userId, data: next });
    return next;
  },
});

// ---------------------------------------------------------------------------
// recurring schedules
// ---------------------------------------------------------------------------

export const recurringList = queryGeneric({
  args: { userId: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("recurringSchedules")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    const filtered = args.status ? docs.filter((d) => d.status === args.status) : docs;
    return filtered.sort((a, b) => a.nextRunAt - b.nextRunAt);
  },
});

export const recurringListByClient = queryGeneric({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const docs = await ctx.db
      .query("recurringSchedules")
      .withIndex("by_user_client", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("clientId"), args.clientId))
      .collect();
    return docs.sort((a, b) => a.nextRunAt - b.nextRunAt);
  },
});

export const recurringGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) =>
    docById(ctx, "recurringSchedules", needUser(args.userId), args.id),
});

export const recurringCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    clientId: v.string(),
    projectId: v.optional(v.string()),
    name: v.string(),
    mode: v.string(),
    frequency: v.string(),
    interval: v.number(),
    lineItems: v.any(),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    maxOccurrences: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      clientId: args.clientId,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      name: args.name,
      mode: args.mode,
      frequency: args.frequency,
      interval: args.interval,
      lineItems: args.lineItems,
      startDate: args.startDate,
      ...(args.endDate !== undefined ? { endDate: args.endDate } : {}),
      ...(args.maxOccurrences !== undefined ? { maxOccurrences: args.maxOccurrences } : {}),
      nextRunAt: args.startDate,
      occurrences: 0,
      status: args.status ?? "active",
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("recurringSchedules", doc);
    return doc;
  },
});

export const recurringUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "recurringSchedules", needUser(args.userId), args.id, args.patch),
});

export const recurringRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) =>
    removeDoc(ctx, "recurringSchedules", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// retainers
// ---------------------------------------------------------------------------

export const retainersList = queryGeneric({
  args: { userId: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("retainers")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    const filtered = args.status ? docs.filter((d) => d.status === args.status) : docs;
    return filtered.sort((a, b) => b.startDate - a.startDate);
  },
});

export const retainersListByClient = queryGeneric({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const docs = await ctx.db
      .query("retainers")
      .withIndex("by_user_client", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("clientId"), args.clientId))
      .collect();
    return docs.sort((a, b) => b.startDate - a.startDate);
  },
});

export const retainersGet = queryGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => docById(ctx, "retainers", needUser(args.userId), args.id),
});

export const retainersCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    clientId: v.string(),
    name: v.string(),
    type: v.string(),
    totalHours: v.optional(v.number()),
    amountCents: v.number(),
    hourlyRate: v.optional(v.number()),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    status: v.optional(v.string()),
    recurringScheduleId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      clientId: args.clientId,
      name: args.name,
      type: args.type,
      ...(args.totalHours !== undefined ? { totalHours: args.totalHours } : {}),
      amountCents: args.amountCents,
      ...(args.hourlyRate !== undefined ? { hourlyRate: args.hourlyRate } : {}),
      startDate: args.startDate,
      ...(args.endDate !== undefined ? { endDate: args.endDate } : {}),
      status: args.status ?? "active",
      ...(args.recurringScheduleId !== undefined
        ? { recurringScheduleId: args.recurringScheduleId }
        : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("retainers", doc);
    return doc;
  },
});

export const retainersUpdate = mutationGeneric({
  args: { userId: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    patchDoc(ctx, "retainers", needUser(args.userId), args.id, args.patch),
});

export const retainersRemove = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => removeDoc(ctx, "retainers", needUser(args.userId), args.id),
});

// ---------------------------------------------------------------------------
// transactional workflows (Convex mutations are atomic)
// ---------------------------------------------------------------------------

export const assignInvoiceNumber = mutationGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const current = existing ? normalize(existing.data) : { ...DEFAULT_SETTINGS };
    const { numberPrefix, nextNumber } = current.invoice;
    const result = formatInvoiceNumber(numberPrefix, nextNumber);
    const updated = {
      ...current,
      invoice: { ...current.invoice, nextNumber: nextNumber + 1 },
    };
    if (existing) await ctx.db.patch(existing._id, { data: updated });
    else await ctx.db.insert("settings", { userId, data: updated });
    return result;
  },
});

export const markInvoiceSent = mutationGeneric({
  args: { userId: v.string(), invoiceId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const invoice = await docById(ctx, "invoices", userId, args.invoiceId);
    if (!invoice) throw new Error(`invoices/${args.invoiceId} not found`);
    const now = Date.now();
    await ctx.db.patch(invoice._id, { status: "sent", updatedAt: now });
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    for (const li of lineItems) {
      if (!li?.sourceId) continue;
      const table = li.sourceType === "task" ? "tasks" : li.sourceType === "expense" ? "expenses" : null;
      if (!table) continue;
      const doc = await docById(ctx, table, userId, li.sourceId);
      if (doc) {
        await ctx.db.patch(doc._id, {
          isBilled: true,
          invoiceId: invoice.id,
          updatedAt: now,
        });
      }
    }
    return { sent: true };
  },
});

export const markInvoicePaid = mutationGeneric({
  args: { userId: v.string(), invoiceId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const invoice = await docById(ctx, "invoices", userId, args.invoiceId);
    if (!invoice) throw new Error(`invoices/${args.invoiceId} not found`);
    await ctx.db.patch(invoice._id, { status: "paid", updatedAt: Date.now() });
    return { paid: true };
  },
});

// ---------------------------------------------------------------------------
// share links + timesheet approvals (hosted only)
// ---------------------------------------------------------------------------

export const shareCreate = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    type: v.string(),
    target: v.any(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    const now = Date.now();
    const doc = {
      id: args.id,
      userId,
      type: args.type,
      target: args.target,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("shareLinks", doc);
    return doc;
  },
});

export const shareList = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("shareLinks")
      .withIndex("by_user", (q) => q.eq("userId", needUser(args.userId)))
      .collect();
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Capability lookup for public share-token resolution. No userId: runs only
 * after HMAC signature verification; the signed token is the authorization.
 */
export const shareGetById = queryGeneric({
  args: { id: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("shareLinks")
      .withIndex("by_id", (q) => q.eq("id", args.id))
      .unique(),
});

export const shareRevoke = mutationGeneric({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const doc = await docById(ctx, "shareLinks", needUser(args.userId), args.id);
    if (!doc) throw new Error(`shareLinks/${args.id} not found`);
    await ctx.db.patch(doc._id, { revokedAt: Date.now(), updatedAt: Date.now() });
    return { revoked: true };
  },
});

export const approvalRecord = mutationGeneric({
  args: {
    userId: v.string(),
    id: v.string(),
    shareLinkId: v.string(),
    clientId: v.string(),
    weekStartMs: v.number(),
    approverName: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    // Convex mutations run transactionally: re-checking here makes the
    // one-approval-per-(link, week) rule race-safe.
    const existing = await ctx.db
      .query("timesheetApprovals")
      .withIndex("by_user_link", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("shareLinkId"), args.shareLinkId))
      .filter((q) => q.eq(q.field("weekStartMs"), args.weekStartMs))
      .first();
    if (existing) return existing;
    const doc = {
      id: args.id,
      userId,
      shareLinkId: args.shareLinkId,
      clientId: args.clientId,
      weekStartMs: args.weekStartMs,
      approvedAt: Date.now(),
      ...(args.approverName !== undefined ? { approverName: args.approverName } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
    };
    await ctx.db.insert("timesheetApprovals", doc);
    return doc;
  },
});

export const approvalsListByLink = queryGeneric({
  args: { userId: v.string(), shareLinkId: v.string() },
  handler: async (ctx, args) => {
    const userId = needUser(args.userId);
    return ctx.db
      .query("timesheetApprovals")
      .withIndex("by_user_link", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("shareLinkId"), args.shareLinkId))
      .collect();
  },
});
