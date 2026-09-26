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
export const VERSION = "0.1.0";

/** Minimal API surface handlers need (TallyhandClient satisfies this). */
export interface Api {
  hasToken: boolean;
  health(): Promise<any>;
  listClients(p?: any): Promise<any>;
  createClient(i: any): Promise<any>;
  getClient(id: string): Promise<any>;
  listProjects(p?: any): Promise<any>;
  createProject(i: any): Promise<any>;
  getProject(id: string): Promise<any>;
  listTasks(p?: any): Promise<any>;
  createTask(i: any): Promise<any>;
  updateTask(id: string, p: any): Promise<any>;
  listExpenses(p?: any): Promise<any>;
  createExpense(i: any): Promise<any>;
  listInvoices(p?: any): Promise<any>;
  createInvoice(i: any): Promise<any>;
  getInvoice(id: string): Promise<any>;
  sendInvoice(id: string): Promise<any>;
  markInvoicePaid(id: string): Promise<any>;
  listSchedules(p?: any): Promise<any>;
  createSchedule(i: any): Promise<any>;
  runSchedule(id: string): Promise<any>;
  runScheduler(): Promise<any>;
  listRetainers(p?: any): Promise<any>;
  createRetainer(i: any): Promise<any>;
  getSettings(): Promise<any>;
}

export interface Out {
  json: boolean;
}

export function fail(err: unknown): never {
  if (err instanceof ApiError) {
    console.error(`Error: ${err.message}`);
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
  const pname = await projectName(api, opts.project);
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
  const rows = await Promise.all(
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
  const pname = await projectName(api, opts.project);
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
  let clients = (await api.listClients({ all: true })) as any[];
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
  opts: { client?: string; project?: string; items?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
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
  opts: { status?: string; client?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const invoices = (await api.listInvoices({
    all: true,
    status: opts.status,
    clientId: opts.client,
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
    lineItems,
    startDate,
    nextRunAt: startDate,
    maxOccurrences: opts.endsAfter ? Number(opts.endsAfter) : undefined,
    status: "active",
  });
  emit(out.json, schedule, () => {
    console.log(
      `Recurring schedule "${schedule.name}" created — next run ${fmtDay(schedule.nextRunAt)} (id: ${schedule.id})`,
    );
  });
}

export async function handleRecurringRun(
  api: Api,
  opts: { id?: string },
  out: Out,
): Promise<void> {
  needAuth(api);
  const result = opts.id ? await api.runSchedule(opts.id) : await api.runScheduler();
  emit(out.json, result, () => {
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

export async function handleExport(
  api: Api,
  opts: { entity: string; format?: string; out?: string },
  _out: Out,
): Promise<void> {
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

  if (opts.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.out, text + "\n");
    console.log(`Wrote ${opts.out}`);
  } else {
    console.log(text);
  }
}

export async function handleDoctor(api: TallyhandClient): Promise<void> {
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
}
