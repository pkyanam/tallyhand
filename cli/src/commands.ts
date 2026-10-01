/**
 * Command handlers shared by the CLI and the MCP server.
 * Handlers take an Api (TallyhandClient satisfies it structurally) so tests
 * can inject fakes. Human printing goes through `out.json`; the MCP server
 * calls the lower-level helpers directly and never touches stdout.
 */
import {
  ApiError,
  TallyhandClient,
  resolveConfig,
  readFileConfig,
  writeFileConfig,
  CONFIG_PATH,
} from "./client.js";
import {
  table,
  fmtMoney,
  fmtCents,
  fmtDate,
  fmtDay,
  fmtDuration,
  fmtHours,
  parseDate,
  parseTags,
  parseJsonArray,
  round2,
  emit,
  toCsv,
} from "./format.js";
import {
  collectUnbilled,
  buildUnbilledLineItems,
  invoiceTotals,
  computeLineAmount,
  type LineItemInput,
} from "./billing.js";
export const VERSION = "0.3.0";

/** Minimal API surface handlers need (TallyhandClient satisfies this). */
export interface Api {
  hasToken: boolean;
  extensionList?: TallyhandClient["extensionList"];
  extensionGet?: TallyhandClient["extensionGet"];
  extensionCreate?: TallyhandClient["extensionCreate"];
  extensionUpdate?: TallyhandClient["extensionUpdate"];
  extensionDelete?: TallyhandClient["extensionDelete"];
  extensionBulk?: TallyhandClient["extensionBulk"];
  profile?: TallyhandClient["profile"];
  capabilities?: TallyhandClient["capabilities"];
  listShares?: TallyhandClient["listShares"];
  createShare?: TallyhandClient["createShare"];
  revokeShare?: TallyhandClient["revokeShare"];
  shareApprovals?: TallyhandClient["shareApprovals"];
  dunning?: TallyhandClient["dunning"];
  controlLink?: TallyhandClient["controlLink"];

  health(): Promise<any>;
  listClients(p?: any): Promise<any>;
  createClient(i: any): Promise<any>;
  getClient(id: string): Promise<any>;
  updateClient(id: string, p: any): Promise<any>;
  deleteClient(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  listProjects(p?: any): Promise<any>;
  createProject(i: any): Promise<any>;
  getProject(id: string): Promise<any>;
  updateProject(id: string, p: any): Promise<any>;
  deleteProject(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  listTasks(p?: any): Promise<any>;
  createTask(i: any): Promise<any>;
  getTask(id: string): Promise<any>;
  updateTask(id: string, p: any): Promise<any>;
  deleteTask(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  bulkCreateTasks(items: any[]): Promise<any>;
  listExpenses(p?: any): Promise<any>;
  createExpense(i: any): Promise<any>;
  getExpense(id: string): Promise<any>;
  updateExpense(id: string, p: any): Promise<any>;
  deleteExpense(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  bulkCreateExpenses(items: any[]): Promise<any>;
  listInvoices(p?: any): Promise<any>;
  createInvoice(i: any): Promise<any>;
  getInvoice(id: string): Promise<any>;
  updateInvoice(id: string, p: any): Promise<any>;
  deleteInvoice(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  sendInvoice(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  markInvoicePaid(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  listSchedules(p?: any): Promise<any>;
  createSchedule(i: any, opts?: { dryRun?: boolean }): Promise<any>;
  getSchedule(id: string): Promise<any>;
  updateSchedule(id: string, p: any): Promise<any>;
  deleteSchedule(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  runSchedule(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  runScheduler(opts?: { dryRun?: boolean }): Promise<any>;
  listRetainers(p?: any): Promise<any>;
  createRetainer(i: any): Promise<any>;
  getRetainer(id: string): Promise<any>;
  updateRetainer(id: string, p: any): Promise<any>;
  deleteRetainer(id: string, opts?: { dryRun?: boolean }): Promise<any>;
  getSettings(): Promise<any>;
  updateSettings(p: any, opts?: { dryRun?: boolean }): Promise<any>;
  backup?(): Promise<{ bundle: Record<string, unknown>; revision: number }>;
  replaceData?(input: { action: "import" | "reset"; expectedRevision: number; confirmation: string; bundle?: unknown }): Promise<any>;
}

export interface Out {
  json: boolean;
}

export function fail(err: unknown): never {
  if (err instanceof ApiError) {
    console.error(`Error: ${err.message}`);
    if (err.details !== undefined) console.error(JSON.stringify({ code: err.code, details: err.details }));
    if (err.status === 401 || err.code === "unauthorized")
      console.error("Hint: bad or missing token — `tally config set token <token>` or TALLYHAND_API_TOKEN.");
    else if (err.code === "connection_failed")
      console.error("Hint: is the Tallyhand server running? Run `tally doctor`.");
    else if (err.status === 404)
      console.error("Hint: double-check the id.");
    else console.error("Hint: run with --json for the raw error, or `tally doctor`.");
  } else if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(`Error: ${String(err)}`);
  }
  process.exit(1);
}

export function needAuth(api: Api): void {
  if (!api.hasToken) {
    throw new Error(
      "No API token configured. Set one via `tally config set token <token>`, the TALLYHAND_API_TOKEN env var, or the --token flag.",
    );
  }
}

const isOpenTimer = (t: any): boolean => !t.endAt;

export async function findOpenTimers(api: Api): Promise<any[]> {
  const tasks = (await api.listTasks({ all: true })) as any[];
  return tasks.filter(isOpenTimer);
}

async function projectName(api: Api, projectId: string): Promise<string> {
  try {
    const p = await api.getProject(projectId);
    return p?.name ?? projectId;
  } catch {
    return projectId;
  }
}

/* ------------------------------------------------------------------ */
/* handlers (exported for tests)                                       */
/* ------------------------------------------------------------------ */

export async function handleTimerStart(
  api: Api,
  opts: { project: string; note?: string; tags?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const now = Date.now();
  const task = await api.createTask({
    projectId: opts.project,
    name: opts.note || "Timer entry",
    notes: opts.note || undefined,
    startAt: now,
    endAt: 0, // open-timer convention: endAt missing/0 == running
    durationMinutes: 0,
    tags: parseTags(opts.tags),
  });
  const pname = out.json ? opts.project : await projectName(api, opts.project);
  emit(out.json, task, () => {
    console.log(`Timer started on "${pname}" at ${fmtDate(now)} (id: ${task.id})`);
  });
}

export async function handleTimerStop(
  api: Api,
  opts: { id?: string; note?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const open = await findOpenTimers(api);
  let target: any;
  if (opts.id) {
    target = open.find((t) => t.id === opts.id);
    if (!target) throw new Error(`No running timer with id ${opts.id}.`);
  } else if (open.length === 0) {
    throw new Error("No running timer.");
  } else if (open.length > 1) {
    const list = open.map((t) => `  ${t.id}  started ${fmtDate(t.startAt)}`).join("\n");
    throw new Error(
      `${open.length} running timers — stop one via:\n${list}\ntally timer stop --id <id>`,
    );
  } else {
    target = open[0];
  }
  const endAt = Date.now();
  const minutes = Math.max(1, Math.round((endAt - target.startAt) / 60000));
  const updated = await api.updateTask(target.id, {
    endAt,
    durationMinutes: minutes,
    ...(opts.note ? { notes: opts.note } : {}),
  });
  emit(out.json, updated, () => {
    console.log(
      `Stopped "${target.name ?? "Timer entry"}" — ${fmtDuration(endAt - target.startAt)} (${minutes} min logged).`,
    );
  });
}

export async function handleTimerStatus(api: Api, out: Out): Promise<void> {
  needAuth(api);
  const open = await findOpenTimers(api);
  const now = Date.now();
  const rows = out.json ? [] : await Promise.all(
    open.map(async (t) => [
      t.id,
      await projectName(api, t.projectId),
      fmtDate(t.startAt),
      fmtDuration(now - t.startAt),
    ]),
  );
  emit(out.json, open, () => {
    if (open.length === 0) {
      console.log("No timer running.");
      return;
    }
    console.log(table(["ID", "PROJECT", "STARTED", "ELAPSED"], rows));
  });
}

export async function handleLog(
  api: Api,
  opts: { project: string; minutes: number; date?: string; note?: string; tags?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const minutes = Number(opts.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error("--minutes must be a positive number.");
  const startAt = opts.date ? parseDate(opts.date) : Date.now();
  const task = await api.createTask({
    projectId: opts.project,
    name: opts.note || "Time entry",
    notes: opts.note || undefined,
    startAt,
    endAt: startAt + Math.round(minutes * 60000),
    durationMinutes: round2(minutes),
    tags: parseTags(opts.tags),
  });
  const pname = out.json ? opts.project : await projectName(api, opts.project);
  emit(out.json, task, () => {
    console.log(`Logged ${fmtHours(round2(minutes))} on "${pname}" (${fmtDay(startAt)}).`);
  });
}

export async function handleClientsList(
  api: Api,
  opts: { archived?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  let clients = (await api.listClients({ all: true, includeArchived: !!opts.archived })) as any[];
  if (!opts.archived) clients = clients.filter((c) => !c.archived);
  emit(out.json, clients, () => {
    if (clients.length === 0) {
      console.log("No clients yet. Add one: tally clients create --name \"Acme\"");
      return;
    }
    console.log(
      table(
        ["ID", "NAME", "EMAIL", "RATE", "ARCHIVED"],
        clients.map((c) => [
          c.id,
          c.name,
          c.email ?? "",
          c.defaultRate != null ? fmtMoney(c.defaultRate) + "/h" : "",
          c.archived ? "yes" : "",
        ]),
      ),
    );
  });
}

export async function handleClientsCreate(
  api: Api,
  opts: { name: string; email?: string; rate?: number },
  out: Out,
): Promise<void> {
  needAuth(api);
  const client = await api.createClient({
    name: opts.name,
    email: opts.email || undefined,
    defaultRate: opts.rate !== undefined ? Number(opts.rate) : undefined,
  });
  emit(out.json, client, () => {
    console.log(`Client "${client.name}" created (id: ${client.id})`);
  });
}

export async function handleProjectsList(
  api: Api,
  opts: { client?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  let projects = (await api.listProjects({ all: true })) as any[];
  if (opts.client) projects = projects.filter((p) => p.clientId === opts.client);
  emit(out.json, projects, () => {
    if (projects.length === 0) {
      console.log("No projects yet. Add one: tally projects create --client <id> --name \"Website\"");
      return;
    }
    console.log(
      table(
        ["ID", "NAME", "CLIENT", "RATE", "ARCHIVED"],
        projects.map((p) => [
          p.id,
          p.name,
          p.clientId,
          p.rateOverride != null ? fmtMoney(p.rateOverride) + "/h" : "",
          p.archived ? "yes" : "",
        ]),
      ),
    );
  });
}

export async function handleProjectsCreate(
  api: Api,
  opts: { client: string; name: string; rate?: number },
  out: Out,
): Promise<void> {
  needAuth(api);
  const project = await api.createProject({
    clientId: opts.client,
    name: opts.name,
    rateOverride: opts.rate !== undefined ? Number(opts.rate) : undefined,
  });
  emit(out.json, project, () => {
    console.log(`Project "${project.name}" created (id: ${project.id})`);
  });
}

export async function handleUnbilled(
  api: Api,
  opts: { client?: string; project?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const rows = await collectUnbilled(api, {
    clientId: opts.client,
    projectId: opts.project,
  });
  emit(out.json, rows, () => {
    if (rows.length === 0) {
      console.log("Nothing unbilled. Nice.");
      return;
    }
    console.log(
      table(
        ["CLIENT", "PROJECT", "TASKS", "EXPENSES", "HOURS", "AMOUNT"],
        rows.map((r) => [
          r.clientName,
          r.projectName,
          r.taskCount || "",
          r.expenseCount || "",
          fmtHours(round2(r.minutes)),
          fmtMoney(round2(r.taskAmount + r.expenseAmount)),
        ]),
      ),
    );
    const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
    const totalAmt = round2(
      rows.reduce((s, r) => s + r.taskAmount + r.expenseAmount, 0),
    );
    console.log(`\nTotal: ${fmtHours(round2(totalMin))} — ${fmtMoney(totalAmt)}`);
  });
}

export async function handleInvoiceDraft(
  api: Api,
  opts: {
    client?: string;
    project?: string;
    items?: string;
    currency?: string;
    taxRegion?: string;
    taxRate?: string;
    paymentMethod?: string;
    paymentUrl?: string;
    qr?: boolean;
    qrDescription?: string;
    amountInWords?: boolean;
    template?: string;
    invoiceType?: string;
  },
  out: Out,
): Promise<void> {
  needAuth(api);
  // -- flag validation --------------------------------------------------
  let taxRate: number | undefined;
  if (opts.taxRate !== undefined) {
    taxRate = Number(opts.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)
      throw new Error("--tax-rate must be a number between 0 and 100.");
  }
  let taxRegion: string | undefined;
  if (opts.taxRegion !== undefined) {
    if (!["US", "EU"].includes(opts.taxRegion))
      throw new Error('--tax-region must be "US" or "EU".');
    taxRegion = opts.taxRegion;
  }
  let template: string | undefined;
  if (opts.template !== undefined) {
    if (!["default", "stripe"].includes(opts.template))
      throw new Error('--template must be "default" or "stripe".');
    template = opts.template;
  }
  let lineItems: LineItemInput[];
  let clientId: string;
  if (opts.items) {
    if (!opts.client) throw new Error("--client is required with --items.");
    clientId = opts.client;
    const arr = parseJsonArray(opts.items, "--items");
    lineItems = arr.map((it: any, i: number) => {
      if (!it || typeof it.description !== "string" || !it.description.trim())
        throw new Error(`--items[${i}].description is required.`);
      const quantity = Number(it.quantity ?? 1);
      const rate = Number(it.rate ?? 0);
      if (!Number.isFinite(quantity) || !Number.isFinite(rate))
        throw new Error(`--items[${i}].quantity/rate must be numbers.`);
      return {
        description: it.description,
        quantity,
        rate,
        amount: computeLineAmount(quantity, rate),
        sourceType: "manual" as const,
        ...(it.taxRate != null ? { taxRate: Number(it.taxRate) } : {}),
        ...(it.taxLabel ? { taxLabel: it.taxLabel } : {}),
      };
    });
  } else {
    if (!opts.client) throw new Error("Provide --client <id> or --items '<json>'.");
    clientId = opts.client;
    const built = await buildUnbilledLineItems(api, {
      clientId,
      projectId: opts.project,
    });
    if (built.lineItems.length === 0)
      throw new Error("Nothing unbilled for this client — nothing to draft.");
    lineItems = built.lineItems;
  }
  // --tax-rate applies to every line that doesn't set its own taxRate.
  if (taxRate !== undefined) {
    lineItems = lineItems.map((li) =>
      li.taxRate == null ? { ...li, taxRate } : li,
    );
  }
  const { subtotal, total } = invoiceTotals(lineItems);
  const now = Date.now();
  const invoice = await api.createInvoice({
    clientId,
    lineItems,
    subtotal,
    total,
    issueDate: now,
    dueDate: now + 14 * 24 * 3600 * 1000,
    status: "draft",
    ...(opts.currency ? { currency: opts.currency } : {}),
    ...(taxRegion ? { taxRegion } : {}),
    ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
    ...(opts.paymentUrl ? { paymentUrl: opts.paymentUrl } : {}),
    ...(opts.qr !== undefined ? { qrEnabled: opts.qr } : {}),
    ...(opts.qrDescription ? { qrDescription: opts.qrDescription } : {}),
    ...(opts.amountInWords !== undefined ? { amountInWords: opts.amountInWords } : {}),
    ...(template ? { template } : {}),
    ...(opts.invoiceType ? { invoiceType: opts.invoiceType } : {}),
  });
  emit(out.json, invoice, () => {
    console.log(
      `Draft invoice ${invoice.invoiceNumber ?? invoice.id} created — total ${fmtMoney(invoice.total ?? total)} (id: ${invoice.id})`,
    );
    console.log("Nothing is billed yet — review, then `tally invoice send <id>`.");
  });
}

export async function handleInvoiceList(
  api: Api,
  opts: { status?: string; client?: string; overdue?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const invoices = (await api.listInvoices({
    all: true,
    status: opts.status,
    clientId: opts.client,
    overdue: opts.overdue,
  })) as any[];
  emit(out.json, invoices, () => {
    if (invoices.length === 0) {
      console.log("No invoices.");
      return;
    }
    console.log(
      table(
        ["NUMBER", "CLIENT", "ISSUED", "DUE", "STATUS", "TOTAL"],
        invoices.map((i) => [
          i.invoiceNumber ?? i.id,
          i.clientId,
          fmtDay(i.issueDate),
          fmtDay(i.dueDate),
          i.status,
          fmtMoney(i.total),
        ]),
      ),
    );
  });
}

export async function handleInvoiceShow(
  api: Api,
  id: string,
  out: Out,
): Promise<void> {
  needAuth(api);
  const inv = await api.getInvoice(id);
  emit(out.json, inv, () => {
    console.log(`Invoice ${inv.invoiceNumber ?? inv.id} — ${inv.status}`);
    console.log(`Client: ${inv.clientId}   Issued: ${fmtDay(inv.issueDate)}   Due: ${fmtDay(inv.dueDate)}`);
    if (inv.publicToken) console.log(`Public link token: ${inv.publicToken}`);
    console.log(
      table(
        ["DESCRIPTION", "QTY", "RATE", "AMOUNT"],
        (inv.lineItems ?? []).map((li: any) => [
          li.description,
          li.quantity,
          fmtMoney(li.rate),
          fmtMoney(li.amount),
        ]),
      ),
    );
    console.log(`Total: ${fmtMoney(inv.total)}`);
    if (inv.notes) console.log(`Notes: ${inv.notes}`);
  });
}

export async function handleRecurringList(
  api: Api,
  opts: { status?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  let schedules = (await api.listSchedules({ all: true })) as any[];
  if (opts.status) schedules = schedules.filter((s) => s.status === opts.status);
  emit(out.json, schedules, () => {
    if (schedules.length === 0) {
      console.log("No recurring schedules.");
      return;
    }
    console.log(
      table(
        ["ID", "NAME", "CLIENT", "MODE", "EVERY", "NEXT RUN", "STATUS"],
        schedules.map((s) => [
          s.id,
          s.name,
          s.clientId,
          s.mode,
          s.interval > 1 ? `${s.interval} ${s.frequency}` : s.frequency,
          fmtDay(s.nextRunAt),
          s.status,
        ]),
      ),
    );
  });
}

export async function handleRecurringCreate(
  api: Api,
  opts: {
    dryRun?: boolean;
    client: string;
    name: string;
    frequency: string;
    interval?: number;
    mode?: string;
    project?: string;
    lineItems?: string;
    start?: string;
    endsAfter?: number;
  },
  out: Out,
): Promise<void> {
  needAuth(api);
  const allowed = ["weekly", "monthly", "quarterly", "yearly"];
  if (!allowed.includes(opts.frequency))
    throw new Error(`--frequency must be one of: ${allowed.join(", ")}`);
  const mode = opts.mode ?? "fixed";
  if (!["fixed", "unbilled"].includes(mode))
    throw new Error(`--mode must be "fixed" or "unbilled".`);
  let lineItems: LineItemInput[] | undefined;
  if (opts.lineItems) {
    const arr = parseJsonArray(opts.lineItems, "--line-items");
    lineItems = arr.map((it: any, i: number) => {
      if (!it || typeof it.description !== "string" || !it.description.trim())
        throw new Error(`--line-items[${i}].description is required.`);
      const quantity = Number(it.quantity ?? 1);
      const rate = Number(it.rate ?? 0);
      return {
        description: it.description,
        quantity,
        rate,
        amount: computeLineAmount(quantity, rate),
        sourceType: "manual" as const,
      };
    });
  } else if (mode === "fixed") {
    throw new Error('Mode "fixed" needs --line-items \'<json array>\'.');
  }
  const startDate = opts.start ? parseDate(opts.start) : Date.now();
  const schedule = await api.createSchedule({
    clientId: opts.client,
    projectId: opts.project || undefined,
    name: opts.name,
    mode,
    frequency: opts.frequency,
    interval: opts.interval ? Number(opts.interval) : 1,
    lineItems: (lineItems ?? []).map(({ description, quantity, rate }) => ({ description, quantity, rate })),
    startDate,
    nextRunAt: startDate,
    maxOccurrences: opts.endsAfter ? Number(opts.endsAfter) : undefined,
    status: "active",
  }, { dryRun: opts.dryRun });
  emit(out.json, schedule, () => {
    console.log(
      opts.dryRun ? "Recurring schedule validated; no changes made." : `Recurring schedule "${schedule.name}" created — next run ${fmtDay(schedule.nextRunAt)} (id: ${schedule.id})`,
    );
  });
}

export async function handleRecurringRun(
  api: Api,
  opts: { id?: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const dryRun = { dryRun: opts.dryRun };
  const result = opts.id
    ? await api.runSchedule(opts.id, dryRun)
    : await api.runScheduler(dryRun);
  emit(out.json, result, () => {
    if (result?.dryRun) {
      const due = result.due ?? [result.preview].filter(Boolean);
      if (due.length === 0) {
        console.log("Dry run — no schedules are due.");
        return;
      }
      console.log("Dry run — due schedules (nothing created):");
      console.log(
        table(
          ["SCHEDULE", "WOULD CREATE", "ITEMS", "EST. TOTAL", "NEXT RUN"],
          due.map((d: any) => [
            d.name ?? d.scheduleId,
            d.wouldCreateInvoice ? "yes" : "no (empty)",
            d.lineItemCount,
            fmtMoney(d.estimatedTotal),
            fmtDay(d.nextRunAt),
          ]),
        ),
      );
      return;
    }
    console.log(
      typeof result === "object" && result !== null
        ? `Scheduler run complete: ${JSON.stringify(result)}`
        : String(result),
    );
  });
}

export async function handleRetainerList(
  api: Api,
  opts: { client?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const retainers = (await api.listRetainers({
    all: true,
    clientId: opts.client,
  })) as any[];
  emit(out.json, retainers, () => {
    if (retainers.length === 0) {
      console.log("No retainers.");
      return;
    }
    console.log(
      table(
        ["ID", "NAME", "CLIENT", "TYPE", "HOURS", "AMOUNT", "STATUS"],
        retainers.map((r) => [
          r.id,
          r.name,
          r.clientId,
          r.type,
          r.totalHours ?? "",
          r.amountCents != null ? fmtMoney(r.amountCents / 100) : "",
          r.status,
        ]),
      ),
    );
  });
}

export async function handleRetainerCreate(
  api: Api,
  opts: {
    client: string;
    name: string;
    type: string;
    hours?: number;
    amountCents?: number;
    start?: string;
  },
  out: Out,
): Promise<void> {
  needAuth(api);
  if (!["prepaid-hours", "monthly-fee"].includes(opts.type))
    throw new Error('--type must be "prepaid-hours" or "monthly-fee".');
  const retainer = await api.createRetainer({
    clientId: opts.client,
    name: opts.name,
    type: opts.type,
    totalHours: opts.hours !== undefined ? Number(opts.hours) : undefined,
    amountCents: opts.amountCents !== undefined ? Math.round(Number(opts.amountCents)) : undefined,
    startDate: opts.start ? parseDate(opts.start) : Date.now(),
    status: "active",
  });
  emit(out.json, retainer, () => {
    console.log(`Retainer "${retainer.name}" created (id: ${retainer.id})`);
  });
}

export async function handleExpenseAdd(
  api: Api,
  opts: {
    amount: number;
    category: string;
    client?: string;
    project?: string;
    date?: string;
    note?: string;
  },
  out: Out,
): Promise<void> {
  needAuth(api);
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("--amount must be a positive number (dollars).");
  const expense = await api.createExpense({
    amount: round2(amount),
    category: opts.category,
    clientId: opts.client || undefined,
    projectId: opts.project || undefined,
    date: opts.date ? parseDate(opts.date) : Date.now(),
    note: opts.note || undefined,
  });
  emit(out.json, expense, () => {
    console.log(`Expense ${fmtMoney(expense.amount)} (${expense.category}) logged (id: ${expense.id})`);
  });
}

const EXPORT_ENTITIES = ["clients", "projects", "tasks", "expenses", "invoices"] as const;

/* ------------------------------------------------------------------ */
/* CRUD completions (show / update / delete per entity)                 */
/* ------------------------------------------------------------------ */

export async function handleClientShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const c = await api.getClient(id);
  emit(out.json, c, () => {
    console.log(`Client "${c.name}" (${c.id})`);
    if (c.email) console.log(`Email: ${c.email}`);
    if (c.defaultRate != null) console.log(`Default rate: ${fmtMoney(c.defaultRate)}/h`);
    if (c.address) console.log(`Address: ${c.address}`);
    if (c.notes) console.log(`Notes: ${c.notes}`);
    if (c.archived) console.log("Archived: yes");
  });
}

export async function handleClientUpdate(
  api: Api,
  opts: { id: string; name?: string; email?: string; rate?: number; notes?: string; archived?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.email !== undefined) patch.email = opts.email || undefined;
  if (opts.rate !== undefined) patch.defaultRate = Number(opts.rate);
  if (opts.notes !== undefined) patch.notes = opts.notes;
  if (opts.archived !== undefined) patch.archived = opts.archived;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const client = await api.updateClient(opts.id, patch);
  emit(out.json, client, () => console.log(`Client "${client.name}" updated.`));
}

export async function handleClientDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteClient(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete client "${res.wouldDelete.name}" (${res.wouldDelete.id}).`);
    else console.log(`Client ${opts.id} deleted.`);
  });
}

export async function handleProjectShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const p = await api.getProject(id);
  emit(out.json, p, () => {
    console.log(`Project "${p.name}" (${p.id})`);
    console.log(`Client: ${p.clientId}`);
    if (p.rateOverride != null) console.log(`Rate override: ${fmtMoney(p.rateOverride)}/h`);
    if (p.archived) console.log("Archived: yes");
  });
}

export async function handleProjectUpdate(
  api: Api,
  opts: { id: string; name?: string; client?: string; rate?: number; archived?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.client !== undefined) patch.clientId = opts.client;
  if (opts.rate !== undefined) patch.rateOverride = Number(opts.rate);
  if (opts.archived !== undefined) patch.archived = opts.archived;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const project = await api.updateProject(opts.id, patch);
  emit(out.json, project, () => console.log(`Project "${project.name}" updated.`));
}

export async function handleProjectDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteProject(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete project "${res.wouldDelete.name}" (${res.wouldDelete.id}).`);
    else console.log(`Project ${opts.id} deleted.`);
  });
}

export async function handleTasksList(
  api: Api,
  opts: { project?: string; client?: string; billed?: boolean; unbilled?: boolean; from?: string; to?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const params: Record<string, unknown> = { all: true };
  if (opts.project) params.projectId = opts.project;
  if (opts.client) params.clientId = opts.client;
  if (opts.billed) params.isBilled = true;
  if (opts.unbilled) params.isBilled = false;
  if (opts.from) params.date_from = parseDate(opts.from);
  if (opts.to) params.date_to = parseDate(opts.to) + 86400000 - 1;
  const tasks = (await api.listTasks(params)) as any[];
  emit(out.json, tasks, () => {
    if (tasks.length === 0) {
      console.log("No tasks match.");
      return;
    }
    console.log(
      table(
        ["ID", "NAME", "PROJECT", "STARTED", "DURATION", "BILLED"],
        tasks.map((t) => [
          t.id,
          t.name,
          t.projectId,
          fmtDate(t.startAt),
          !t.endAt ? "running" : fmtDuration(t.endAt - t.startAt),
          t.isBilled ? "yes" : "",
        ]),
      ),
    );
  });
}

export async function handleTaskShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const t = await api.getTask(id);
  emit(out.json, t, () => {
    console.log(`Task "${t.name}" (${t.id})`);
    console.log(`Project: ${t.projectId}   Started: ${fmtDate(t.startAt)}`);
    console.log(`Duration: ${!t.endAt ? "running" : fmtDuration(t.endAt - t.startAt)} (${t.durationMinutes} min)`);
    if (t.notes) console.log(`Notes: ${t.notes}`);
    if (t.tags?.length) console.log(`Tags: ${t.tags.join(", ")}`);
    console.log(`Billed: ${t.isBilled ? `yes (${t.invoiceId})` : "no"}`);
  });
}

export async function handleTaskUpdate(
  api: Api,
  opts: { id: string; minutes?: number; date?: string; note?: string; project?: string; billed?: boolean; unbilled?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.project !== undefined) patch.projectId = opts.project;
  if (opts.note !== undefined) patch.notes = opts.note;
  if (opts.minutes !== undefined) {
    const minutes = Number(opts.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes must be positive.");
    const existing = await api.getTask(opts.id);
    const startAt = existing.startAt;
    patch.durationMinutes = round2(minutes);
    patch.endAt = startAt + Math.round(minutes * 60000);
  }
  if (opts.date !== undefined) {
    const day = parseDate(opts.date);
    const existing = await api.getTask(opts.id);
    const durMs = (existing.endAt || Date.now()) - existing.startAt;
    patch.startAt = day;
    if (existing.endAt) patch.endAt = day + durMs;
  }
  if (opts.billed) patch.isBilled = true;
  if (opts.unbilled) patch.isBilled = false;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const task = await api.updateTask(opts.id, patch);
  emit(out.json, task, () => console.log(`Task "${task.name}" updated.`));
}

export async function handleTaskDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteTask(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete task "${res.wouldDelete.name}" (${res.wouldDelete.id}).`);
    else console.log(`Task ${opts.id} deleted.`);
  });
}

export async function handleExpensesList(
  api: Api,
  opts: { client?: string; project?: string; category?: string; billed?: boolean; unbilled?: boolean; from?: string; to?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const params: Record<string, unknown> = { all: true };
  if (opts.client) params.clientId = opts.client;
  if (opts.project) params.projectId = opts.project;
  if (opts.category) params.category = opts.category;
  if (opts.billed) params.isBilled = true;
  if (opts.unbilled) params.isBilled = false;
  if (opts.from) params.date_from = parseDate(opts.from);
  if (opts.to) params.date_to = parseDate(opts.to) + 86400000 - 1;
  const expenses = (await api.listExpenses(params)) as any[];
  emit(out.json, expenses, () => {
    if (expenses.length === 0) {
      console.log("No expenses match.");
      return;
    }
    console.log(
      table(
        ["ID", "DATE", "CATEGORY", "AMOUNT", "CLIENT", "BILLED"],
        expenses.map((e) => [
          e.id,
          fmtDay(e.date),
          e.category,
          fmtMoney(e.amount),
          e.clientId ?? "",
          e.isBilled ? "yes" : "",
        ]),
      ),
    );
  });
}

export async function handleExpenseShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const e = await api.getExpense(id);
  emit(out.json, e, () => {
    console.log(`Expense ${fmtMoney(e.amount)} (${e.category}) — ${e.id}`);
    console.log(`Date: ${fmtDay(e.date)}   Client: ${e.clientId ?? "-"}   Project: ${e.projectId ?? "-"}`);
    if (e.note) console.log(`Note: ${e.note}`);
    console.log(`Billed: ${e.isBilled ? `yes (${e.invoiceId})` : "no"}`);
  });
}

export async function handleExpenseUpdate(
  api: Api,
  opts: { id: string; amount?: number; category?: string; note?: string; date?: string; client?: string; project?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.amount !== undefined) {
    const amount = Number(opts.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("--amount must be positive.");
    patch.amount = round2(amount);
  }
  if (opts.category !== undefined) patch.category = opts.category;
  if (opts.note !== undefined) patch.note = opts.note;
  if (opts.date !== undefined) patch.date = parseDate(opts.date);
  if (opts.client !== undefined) patch.clientId = opts.client || undefined;
  if (opts.project !== undefined) patch.projectId = opts.project || undefined;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const expense = await api.updateExpense(opts.id, patch);
  emit(out.json, expense, () => console.log(`Expense ${expense.id} updated.`));
}

export async function handleExpenseDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteExpense(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete expense ${fmtMoney(res.wouldDelete.amount)} (${res.wouldDelete.id}).`);
    else console.log(`Expense ${opts.id} deleted.`);
  });
}

export async function handleInvoiceUpdate(
  api: Api,
  opts: {
    id: string;
    notes?: string;
    dueDate?: string;
    number?: string;
    currency?: string;
    taxRegion?: string;
    paymentMethod?: string;
    paymentUrl?: string;
    qr?: boolean;
    qrDescription?: string;
    amountInWords?: boolean;
    template?: string;
    invoiceType?: string;
  },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.notes !== undefined) patch.notes = opts.notes;
  if (opts.dueDate !== undefined) patch.dueDate = parseDate(opts.dueDate);
  if (opts.number !== undefined) patch.invoiceNumber = opts.number;
  if (opts.currency !== undefined) patch.currency = opts.currency;
  if (opts.taxRegion !== undefined) {
    if (!["US", "EU"].includes(opts.taxRegion))
      throw new Error('--tax-region must be "US" or "EU".');
    patch.taxRegion = opts.taxRegion;
  }
  if (opts.paymentMethod !== undefined) patch.paymentMethod = opts.paymentMethod;
  if (opts.paymentUrl !== undefined) patch.paymentUrl = opts.paymentUrl;
  if (opts.qr !== undefined) patch.qrEnabled = opts.qr;
  if (opts.qrDescription !== undefined) patch.qrDescription = opts.qrDescription;
  if (opts.amountInWords !== undefined) patch.amountInWords = opts.amountInWords;
  if (opts.template !== undefined) {
    if (!["default", "stripe"].includes(opts.template))
      throw new Error('--template must be "default" or "stripe".');
    patch.template = opts.template;
  }
  if (opts.invoiceType !== undefined) patch.invoiceType = opts.invoiceType;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const invoice = await api.updateInvoice(opts.id, patch);
  emit(out.json, invoice, () => console.log(`Invoice ${invoice.invoiceNumber ?? opts.id} updated.`));
}

export async function handleInvoiceDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteInvoice(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete invoice ${res.wouldDelete.invoiceNumber} (${res.wouldDelete.id}).`);
    else console.log(`Invoice ${opts.id} deleted.`);
  });
}

export async function handleRecurringShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const s = await api.getSchedule(id);
  emit(out.json, s, () => {
    console.log(`Schedule "${s.name}" (${s.id}) — ${s.status}`);
    console.log(`Client: ${s.clientId}   Mode: ${s.mode}   Every: ${s.interval} ${s.frequency}`);
    console.log(`Next run: ${fmtDay(s.nextRunAt)}   Occurrences: ${s.occurrences ?? 0}`);
    if (s.lineItems?.length) {
      console.log(
        table(
          ["DESCRIPTION", "QTY", "RATE"],
          s.lineItems.map((li: any) => [li.description, li.quantity, fmtMoney(li.rate)]),
        ),
      );
    }
  });
}

export async function handleRecurringUpdate(
  api: Api,
  opts: { id: string; name?: string; status?: string; notes?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.status !== undefined) {
    if (!["active", "paused", "ended"].includes(opts.status))
      throw new Error('--status must be "active", "paused", or "ended".');
    patch.status = opts.status;
  }
  if (opts.notes !== undefined) patch.notes = opts.notes;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const schedule = await api.updateSchedule(opts.id, patch);
  emit(out.json, schedule, () => console.log(`Schedule "${schedule.name}" updated.`));
}

export async function handleRecurringDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteSchedule(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete schedule "${res.wouldDelete.name}" (${res.wouldDelete.id}).`);
    else console.log(`Schedule ${opts.id} deleted.`);
  });
}

export async function handleRetainerShow(api: Api, id: string, out: Out): Promise<void> {
  needAuth(api);
  const r = await api.getRetainer(id);
  emit(out.json, r, () => {
    console.log(`Retainer "${r.name}" (${r.id}) — ${r.status}`);
    console.log(`Client: ${r.clientId}   Type: ${r.type}`);
    if (r.totalHours != null) console.log(`Hours: ${r.totalHours}`);
    if (r.amountCents != null) console.log(`Amount: ${fmtCents(r.amountCents)}`);
    console.log(`Start: ${fmtDay(r.startDate)}`);
    if (r.notes) console.log(`Notes: ${r.notes}`);
  });
}

export async function handleRetainerUpdate(
  api: Api,
  opts: { id: string; name?: string; status?: string; notes?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.status !== undefined) {
    if (!["active", "paused", "depleted", "ended"].includes(opts.status))
      throw new Error('--status must be "active", "paused", "depleted", or "ended".');
    patch.status = opts.status;
  }
  if (opts.notes !== undefined) patch.notes = opts.notes;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to update — pass at least one field.");
  const retainer = await api.updateRetainer(opts.id, patch);
  emit(out.json, retainer, () => console.log(`Retainer "${retainer.name}" updated.`));
}

export async function handleRetainerDelete(
  api: Api,
  opts: { id: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  const res = await api.deleteRetainer(opts.id, { dryRun: opts.dryRun });
  emit(out.json, res ?? { deleted: opts.id }, () => {
    if (res?.dryRun) console.log(`Dry run — would delete retainer "${res.wouldDelete.name}" (${res.wouldDelete.id}).`);
    else console.log(`Retainer ${opts.id} deleted.`);
  });
}

export async function handleSettingsShow(api: Api, out: Out): Promise<void> {
  needAuth(api);
  const s = await api.getSettings();
  emit(out.json, s, () => {
    console.log(`Business: ${s.business?.name ?? "-"} (${s.business?.email ?? "-"})`);
    console.log(`Invoice prefix: ${s.invoice?.numberPrefix ?? "-"}   Next number: ${s.invoice?.nextNumber ?? "-"}`);
    console.log(`Payment terms: ${s.invoice?.paymentTermsDays ?? "-"} days`);
  });
}

export async function handleSettingsSet(
  api: Api,
  opts: { patch: string; dryRun?: boolean },
  out: Out,
): Promise<void> {
  needAuth(api);
  let patch: unknown;
  try {
    patch = JSON.parse(opts.patch);
  } catch {
    throw new Error("--patch must be valid JSON, e.g. '{\"invoice\":{\"paymentTermsDays\":30}}'.");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("--patch must be a JSON object.");
  const updated = await api.updateSettings(patch as Record<string, unknown>, { dryRun: opts.dryRun });
  emit(out.json, updated, () => console.log(opts.dryRun ? "Settings patch validated; no changes saved." : "Settings updated."));
}

/** Monthly revenue summary: paid invoices issued in YYYY-MM. */
export async function handleReportRevenue(
  api: Api,
  opts: { month: string; client?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const m = /^(\d{4})-(\d{2})$/.exec(opts.month.trim());
  if (!m) throw new Error('--month must be "YYYY-MM", e.g. 2026-09.');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error('--month must be "YYYY-MM", e.g. 2026-09.');
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  const invoices = (await api.listInvoices({
    all: true,
    status: "paid",
    date_from: start,
    date_to: end - 1,
    clientId: opts.client,
  })) as any[];
  const byClient = new Map<string, { count: number; total: number }>();
  for (const inv of invoices) {
    const row = byClient.get(inv.clientId) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total = round2(row.total + (inv.total ?? 0));
    byClient.set(inv.clientId, row);
  }
  const total = round2(invoices.reduce((s, i) => s + (i.total ?? 0), 0));
  const summary = {
    month: opts.month,
    invoices: invoices.length,
    revenue: total,
    byClient: [...byClient.entries()].map(([clientId, r]) => ({ clientId, ...r })),
  };
  emit(out.json, summary, () => {
    console.log(`Revenue ${opts.month}: ${fmtMoney(total)} across ${invoices.length} paid invoice(s)`);
    if (summary.byClient.length > 0) {
      console.log(
        table(
          ["CLIENT", "INVOICES", "REVENUE"],
          summary.byClient.map((r) => [r.clientId, r.count, fmtMoney(r.total)]),
        ),
      );
    }
  });
}

export async function buildExport(api: Api, opts: { entity: string; format?: string }): Promise<string> {
  needAuth(api);
  const format = opts.format ?? "json";
  if (!["json", "csv"].includes(format))
    throw new Error('--format must be "json" or "csv".');
  const fetchOne = async (entity: string): Promise<any[]> => {
    switch (entity) {
      case "clients":
        return (await api.listClients({ all: true })) as any[];
      case "projects":
        return (await api.listProjects({ all: true })) as any[];
      case "tasks":
        return (await api.listTasks({ all: true })) as any[];
      case "expenses":
        return (await api.listExpenses({ all: true })) as any[];
      case "invoices":
        return (await api.listInvoices({ all: true })) as any[];
      default:
        throw new Error(
          `--entity must be one of: ${[...EXPORT_ENTITIES, "all"].join(", ")}`,
        );
    }
  };
  const data: Record<string, any[]> =
    opts.entity === "all"
      ? Object.fromEntries(
          await Promise.all(
            EXPORT_ENTITIES.map(async (e) => [e, await fetchOne(e)] as const),
          ),
        )
      : { [opts.entity]: await fetchOne(opts.entity) };

  const text =
    format === "csv"
      ? opts.entity === "all"
        ? (() => {
            throw new Error('CSV export needs a single --entity (not "all").');
          })()
        : toCsv(data[opts.entity])
      : JSON.stringify(data, null, 2);

  return text;
}

export async function handleExport(api: Api, opts: { entity: string; format?: string; out?: string }, _out: Out): Promise<void> {
  const text = await buildExport(api, opts);
  if (opts.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.out, text + "\n");
    console.log(`Wrote ${opts.out}`);
  } else {
    console.log(text);
  }
}

export async function handleDoctor(api: Pick<TallyhandClient, "health" | "hasToken" | "listClients" | "getSettings">, opts: { benchmark?: boolean } = {}): Promise<void> {
  let reachOk = false;
  try {
    await api.health();
    reachOk = true;
    console.log("api reachable:      OK");
  } catch (e) {
    console.log("api reachable:      FAIL");
    console.log(
      `  ${(e as Error).message}\n  Hint: start the Tallyhand server, then check --api-url / TALLYHAND_API_URL.`,
    );
  }
  if (!api.hasToken) {
    console.log("auth (token):       SKIP — no token configured");
    console.log("  Hint: `tally config set token <token>` or TALLYHAND_API_TOKEN.");
    process.exit(reachOk ? 0 : 1);
  }
  try {
    await api.listClients({ limit: 1 });
    console.log("auth (token):       OK");
  } catch (e) {
    console.log("auth (token):       FAIL");
    const err = e as ApiError;
    console.log(
      `  ${err.message}\n  Hint: ${err.status === 401 ? "token rejected — regenerate it in the Tallyhand server settings." : "run with --json for details."}`,
    );
    process.exit(1);
  }
  if (opts.benchmark) {
    const durations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await api.getSettings();
      const elapsed = Math.round(performance.now() - started);
      durations.push(elapsed);
      console.log(`settings read ${i + 1}: ${elapsed} ms`);
    }
    const sorted = [...durations].sort((a, b) => a - b);
    console.log(`settings median: ${sorted[2]} ms (5 read-only requests; includes network/platform time)`);
  }
}

export async function handleTasksBulk(api: Api, opts: { items?: string }, out: Out): Promise<void> {
  needAuth(api);
  if (!opts.items) throw new Error("--items JSON array is required, e.g. --items '[{\"projectId\":\"p1\",\"minutes\":60,\"date\":\"2026-09-20\"}]'.");
  const parsed = parseJsonArray(opts.items, "--items");
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("--items must be a non-empty JSON array.");
  const items = parsed.map((entry: any) => {
    if (!entry.projectId) throw new Error("each item needs projectId.");
    const minutes = Number(entry.minutes);
    if (!(minutes > 0)) throw new Error("each item needs a positive minutes.");
    const day = parseDate(entry.date ?? new Date().toISOString().slice(0, 10));
    return {
      projectId: entry.projectId,
      name: entry.note ?? entry.name ?? "Work",
      notes: entry.note,
      startAt: day,
      endAt: day + Math.round(minutes * 60000),
      durationMinutes: round2(minutes),
      tags: entry.tags,
    };
  });
  const result = await api.bulkCreateTasks(items);
  emit(out.json, result, () => {
    const created = Array.isArray(result?.created) ? result.created.length : items.length;
    console.log(`Created ${created} task(s).`);
  });
}

export async function handleExpensesBulk(api: Api, opts: { items?: string }, out: Out): Promise<void> {
  needAuth(api);
  if (!opts.items) throw new Error("--items JSON array is required, e.g. --items '[{\"amount\":42.5,\"category\":\"travel\"}]'.");
  const parsed = parseJsonArray(opts.items, "--items");
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("--items must be a non-empty JSON array.");
  const items = parsed.map((entry: any) => {
    const amount = Number(entry.amount);
    if (!(amount > 0)) throw new Error("each item needs a positive amount (dollars).");
    if (!entry.category) throw new Error("each item needs a category.");
    return {
      amount: round2(amount),
      category: entry.category,
      clientId: entry.client,
      projectId: entry.project,
      date: parseDate(entry.date ?? new Date().toISOString().slice(0, 10)),
      note: entry.note,
    };
  });
  const result = await api.bulkCreateExpenses(items);
  emit(out.json, result, () => {
    const created = Array.isArray(result?.created) ? result.created.length : items.length;
    console.log(`Created ${created} expense(s).`);
  });
}
