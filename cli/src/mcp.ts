/**
 * Tallyhand MCP server — stdio transport. Launched via `tally mcp`.
 *
 * Exposes the Tallyhand API as agent-oriented tools plus a `tally://guide`
 * resource (the agent playbook). Tool descriptions are written FOR AI agents:
 * they say when to use the tool and flag argument gotchas.
 *
 * IMPORTANT: nothing in this module may write to stdout — the stdio transport
 * owns it. All results flow through tool return values.
 */
import { McpServer, ResourceTemplate, completable, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { ApiError } from "./client.js";
import {
  parseDate,
  round2,
} from "./format.js";
import {
  collectUnbilled,
  buildUnbilledLineItems,
  computeLineAmount,
} from "./billing.js";
import { findOpenTimers, type Api } from "./commands.js";
import { registerWorkspaceFeatures } from "./mcp-features.js";
import { toolAuthPolicy, toolAuthError, type McpAuthOptions } from "./mcp-auth.js";
import { mcpSettingsPatchSchema as settingsPatchSchema, withMcpPrivacy } from "./mcp-privacy.js";
import { registerExtendedTools } from "./mcp-extensions.js";
import { registerAgentSkills } from "./mcp-skills.js";
import { GUIDE } from "./guide.js";
import { TallyhandMcpServer } from "./mcp-server.js";

import { RELEASE_VERSION } from "./version.js";
export const MCP_VERSION = RELEASE_VERSION;

const ok = (data: unknown): CallToolResult => ({
  structuredContent: { data: JSON.parse(JSON.stringify(data ?? null)) },
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const err = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : "error";
  const message = e instanceof Error ? e.message : String(e);
  return {
    structuredContent: { data: { error: { code, message, ...(e instanceof ApiError && e.details !== undefined ? { details: e.details } : {}) } } },
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message, ...(e instanceof ApiError && e.details !== undefined ? { details: e.details } : {}) } }) }],
    isError: true as const,
  };
};

const safe =
  (fn: (args: any) => Promise<unknown>) =>
  async (args: any): Promise<ReturnType<typeof ok> | ReturnType<typeof err>> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return err(e);
    }
  };

const dateArg = (desc: string) =>
  z.string().optional().describe(desc + " YYYY-MM-DD (local midnight).");

const moneyNote =
  "Amounts: dollars (e.g. 42.50).";

export function createMcpServer(api: Api, options: McpAuthOptions = {}, observeCatalog?: (tools: ReadonlyArray<Record<string, unknown>>) => void): McpServer {
  api = withMcpPrivacy(api);
  const server = new TallyhandMcpServer({ name: "tallyhand", title: "Tallyhand", version: MCP_VERSION, websiteUrl: "https://tallyhand.xyz" }, {
    instructions: "Read tally://guide. Explicit consent for financial changes, deletes, reset, import. Never request credentials.",
    cacheHints: {
      "tools/list": { ttlMs: 300000, cacheScope: "private" },
      "resources/list": { ttlMs: 300000, cacheScope: "private" },
      "resources/templates/list": { ttlMs: 300000, cacheScope: "private" },
      "prompts/list": { ttlMs: 300000, cacheScope: "private" },
      "resources/read": { ttlMs: 0, cacheScope: "private" },
    },
  });
  const tool = (name: string, description: string, schema: z.ZodRawShape, handler: (args: any, ctx?: ServerContext) => Promise<CallToolResult>) => {
    const readOnlyHint = /^(health_|list_|get_|timer_status$|revenue_|export_)/.test(name);
    const requiredScope = readOnlyHint ? "tally:read" : /^(delete_|reset_|import_|send_invoice$|mark_invoice_paid$)/.test(name) ? "tally:manage" : "tally:write";
    server.registerTool(name, {
      title: name.split("_").map(word => word[0].toUpperCase() + word.slice(1)).join(" "),
      description,
      inputSchema: z.object(schema),
      outputSchema: z.object({ data: z.unknown() }),
      ...toolAuthPolicy(options, requiredScope),
      annotations: { readOnlyHint, destructiveHint: /^(update_|delete_|reset_|import_|send_invoice$|mark_invoice_paid$|timer_stop$|run_recurring_schedules$)/.test(name), idempotentHint: readOnlyHint, openWorldHint: ["send_invoice", "create_invoice_draft", "update_invoice"].includes(name) },
    }, async (args, ctx) => {
      const denied = toolAuthError(options, requiredScope, ctx);
      if (denied) return denied;
      ctx.mcpReq.signal.throwIfAborted();
      const progressToken = ctx.mcpReq._meta?.progressToken;
      if (progressToken !== undefined) await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress: 0, total: 1 } });
      const response = await handler(args, ctx);
      ctx.mcpReq.signal.throwIfAborted();
      if (progressToken !== undefined) await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress: 1, total: 1 } });
      return response;
    });
  };

  tool(
    "health_check",
    "Check application health through the current MCP connection. Hosted MCP requires authentication even for this tool. Use tally doctor to diagnose connectivity before an MCP connection is established.",
    {},
    safe(async () => api.health()),
  );

  tool(
    "list_clients",
    "List clients. Use before anything client-scoped to resolve names to ids. Archived clients are hidden unless includeArchived is true.",
    {
      includeArchived: z.boolean().optional().describe("Include archived clients."),
    },
    safe(async ({ includeArchived }) => {
      let clients = (await api.listClients({ all: true, includeArchived: !!includeArchived })) as any[];
      if (!includeArchived) clients = clients.filter((c) => !c.archived);
      return clients;
    }),
  );

  tool(
    "create_client",
    "Create a client. defaultRate: dollars/hour; applies unless a project overrides it.",
    {
      name: z.string().describe("Client name."),
      email: z.string().optional().describe("Contact email."),
      defaultRate: z.number().optional().describe("Default hourly rate in dollars."),
    },
    safe(async (a) => api.createClient(a)),
  );

  tool(
    "get_client",
    "Fetch one client by id.",
    { id: z.string().describe("Client id.") },
    safe(async ({ id }) => api.getClient(id)),
  );

  tool(
    "list_projects",
    "List projects, optionally filtered by client. Resolve project names to ids here before starting timers or logging time.",
    { clientId: z.string().optional().describe("Filter to one client.") },
    safe(async ({ clientId }) => {
      let projects = (await api.listProjects({ all: true })) as any[];
      if (clientId) projects = projects.filter((p) => p.clientId === clientId);
      return projects;
    }),
  );

  tool(
    "create_project",
    "Create a client project. rateOverride: dollars/hour, overriding client defaultRate.",
    {
      clientId: z.string().describe("Owning client id."),
      name: z.string().describe("Project name."),
      rateOverride: z.number().optional().describe("Hourly rate in dollars."),
    },
    safe(async (a) => api.createProject(a)),
  );

  tool(
    "timer_start",
    "Start a live timer on a project. Creates an open task (endAt = 0 means 'running'). GOTCHA: starting a second timer does not stop the first — check timer_status first if you only want one running.",
    {
      projectId: z.string().describe("Project id."),
      note: z.string().optional().describe("Entry name shown on the invoice line."),
      tags: z.array(z.string()).optional().describe("Tags."),
    },
    safe(async ({ projectId, note, tags }) => {
      const now = Date.now();
      return api.createTask({
        projectId,
        name: note || "Timer entry",
        notes: note || undefined,
        startAt: now,
        endAt: 0,
        durationMinutes: 0,
        tags: tags ?? [],
      });
    }),
  );

  tool(
    "timer_stop",
    "Stop the running timer, stamping endAt and durationMinutes. Errors if zero timers run ('no running timer') or several run — then pass id. Use timer_status to disambiguate.",
    {
      id: z.string().optional().describe("Timer task id (required when several run)."),
      note: z.string().optional().describe("Note to attach to the finished entry."),
    },
    safe(async ({ id, note }) => {
      const open = await findOpenTimers(api);
      let target: any;
      if (id) {
        target = open.find((t) => t.id === id);
        if (!target) throw new Error(`No running timer with id ${id}.`);
      } else if (open.length === 0) {
        throw new Error("No running timer.");
      } else if (open.length > 1) {
        throw new Error(
          `${open.length} running timers — call timer_stop again with one of these ids: ${open.map((t) => t.id).join(", ")}`,
        );
      } else {
        target = open[0];
      }
      const endAt = Date.now();
      const minutes = Math.max(1, Math.round((endAt - target.startAt) / 60000));
      return api.updateTask(target.id, {
        endAt,
        durationMinutes: minutes,
        ...(note ? { notes: note } : {}),
      });
    }),
  );

  tool(
    "timer_status",
    "Show currently running timers with elapsed time. Empty array = nothing running.",
    {},
    safe(async () => {
      const now = Date.now();
      const open = await findOpenTimers(api);
      return open.map((t) => ({
        ...t,
        elapsedMs: now - t.startAt,
        elapsedMinutes: Math.round((now - t.startAt) / 60000),
      }));
    }),
  );

  tool(
    "log_time",
    "Log a completed time entry directly (no live timer). minutes must be positive. date is YYYY-MM-DD; omit for today. Creates startAt/endAt from date + minutes.",
    {
      projectId: z.string().describe("Project id."),
      minutes: z.number().describe("Duration in minutes."),
      date: dateArg("Day of the entry."),
      note: z.string().optional().describe("Entry name."),
      tags: z.array(z.string()).optional(),
    },
    safe(async ({ projectId, minutes, date, note, tags }) => {
      if (!(minutes > 0)) throw new Error("minutes must be positive.");
      const startAt = date ? parseDate(date) : Date.now();
      return api.createTask({
        projectId,
        name: note || "Time entry",
        notes: note || undefined,
        startAt,
        endAt: startAt + Math.round(minutes * 60000),
        durationMinutes: round2(minutes),
        tags: tags ?? [],
      });
    }),
  );

  tool(
    "list_unbilled",
    "Unbilled work grouped by client/project with hours and dollar amounts. Amounts use project.rateOverride ?? client.defaultRate. Review this before drafting an invoice.",
    {
      clientId: z.string().optional(),
      projectId: z.string().optional(),
    },
    safe(async (a) => collectUnbilled(api, a)),
  );

  tool(
    "log_expense",
    `Log an expense. ${moneyNote}`,
    {
      amount: z.number().describe("Amount in dollars."),
      category: z.string().describe("Expense category."),
      clientId: z.string().optional(),
      projectId: z.string().optional(),
      date: dateArg("Expense date."),
      note: z.string().optional(),
    },
    safe(async ({ amount, category, clientId, projectId, date, note }) => {
      if (!(amount > 0)) throw new Error("amount must be positive (dollars).");
      return api.createExpense({
        amount: round2(amount),
        category,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        date: date ? parseDate(date) : Date.now(),
        note: note || undefined,
      });
    }),
  );

  const timeItem = z.object({
    projectId: z.string().describe("Project id."),
    minutes: z.number().positive().describe("Duration in minutes."),
    date: dateArg("Work date."),
    note: z.string().optional().describe("Note."),
    tags: z.array(z.string()).optional(),
  });

  tool(
    "bulk_log_time",
    `Log up to 200 time entries. Invalid input rejects the whole batch; 400 creates nothing. ${moneyNote}`,
    { items: z.array(timeItem).min(1).max(200).describe("Time entries to log.") },
    safe(async ({ items }) =>
      api.bulkCreateTasks(
        items.map((i: any) => {
          const day = parseDate(i.date);
          return {
            projectId: i.projectId,
            name: i.note ?? "Work",
            notes: i.note,
            startAt: day,
            endAt: day + Math.round(i.minutes * 60000),
            durationMinutes: round2(i.minutes),
            tags: i.tags,
          };
        }),
      ),
    ),
  );

  tool(
    "bulk_log_expenses",
    `Log up to 200 expenses. Invalid input rejects the whole batch; 400 creates nothing. ${moneyNote}`,
    {
      items: z
        .array(
          z.object({
            amount: z.number().positive().describe("Amount in dollars."),
            category: z.string(),
            clientId: z.string().optional(),
            projectId: z.string().optional(),
            date: dateArg("Expense date."),
            note: z.string().optional().describe("Note."),
          }),
        )
        .min(1)
        .max(200)
        .describe("Expenses to log."),
    },
    safe(async ({ items }) =>
      api.bulkCreateExpenses(
        items.map((i: any) => ({
          amount: round2(i.amount),
          category: i.category,
          clientId: i.clientId,
          projectId: i.projectId,
          date: parseDate(i.date),
          note: i.note,
        })),
      ),
    ),
  );

  tool(
    "list_invoices",
    "List invoices, optionally filtered by status and/or client.",
    {
      status: z.enum(["draft", "sent", "paid"]).optional(),
      clientId: z.string().optional(),
    },
    safe(async (a) => api.listInvoices({ all: true, ...a })),
  );

  tool(
    "get_invoice",
    "Read invoice, shareUrl and pdfUrl. Disabled/unavailable links are null.",
    { id: z.string().describe("Invoice id.") },
    safe(async ({ id }) => api.getInvoice(id)),
  );

  tool(
    "create_invoice_draft",
    "Create draft with cloud shareUrl/pdfUrl by default; anyone with link can view. Set cloudLinkEnabled:false for private. Nothing billed until send_invoice. Omit items for unbilled work.",
    {
      clientId: z.string().describe("Client id."),
      projectId: z.string().optional().describe("Scope auto-build to one project."),
      cloudLinkEnabled: z.boolean().optional(),
      items: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number(),
            rate: z.number(),
            taxRate: z.number().min(0).max(100).optional().describe("Per-line tax rate as a percent, e.g. 8.5."),
            taxLabel: z.string().optional().describe("Per-line tax label override."),
          }),
        )
        .optional()
        .describe("Items in dollars; omit for unbilled work."),
      currency: z.string().optional().describe("Currency, e.g. USD."),
      taxRegion: z.enum(["US", "EU"]).optional().describe("Tax-jurisdiction behavior. Falls back to settings."),
      taxRate: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Default line tax %."),
      paymentMethod: z.string().optional().describe('Payment method text, e.g. "Bank transfer".'),
      paymentUrl: z.string().optional().describe("URL the client can pay at."),
      qrEnabled: z.boolean().optional().describe("Render a payment QR code on the PDF."),
      qrDescription: z.string().optional().describe("Text shown under the payment QR code."),
      amountInWords: z.boolean().optional().describe("Amount in words."),
      template: z.enum(["default", "stripe"]).optional().describe("PDF template variant."),
      invoiceType: z.string().optional().describe('Document type label, e.g. "Proforma invoice".'),
    },
    safe(async ({ clientId, projectId, cloudLinkEnabled, items, currency, taxRegion, taxRate, paymentMethod, paymentUrl, qrEnabled, qrDescription, amountInWords, template, invoiceType }) => {
      let lineItems: any[];
      let taskCount = 0;
      let expenseCount = 0;
      if (items) {
        lineItems = items.map((it: any) => ({
          description: it.description,
          quantity: it.quantity,
          rate: it.rate,
          amount: computeLineAmount(it.quantity, it.rate),
          sourceType: "manual",
          ...(it.taxRate != null ? { taxRate: it.taxRate } : {}),
          ...(it.taxLabel ? { taxLabel: it.taxLabel } : {}),
        }));
      } else {
        const built = await buildUnbilledLineItems(api, { clientId, projectId });
        if (built.lineItems.length === 0)
          throw new Error("Nothing unbilled for this client.");
        lineItems = built.lineItems;
        taskCount = built.taskCount;
        expenseCount = built.expenseCount;
      }
      if (taxRate !== undefined) {
        lineItems = lineItems.map((li) =>
          li.taxRate == null ? { ...li, taxRate } : li,
        );
      }
      const now = Date.now();
      const invoice = await api.createInvoice({
        clientId,
        lineItems,
        issueDate: now,
        status: "draft",
        ...(cloudLinkEnabled !== undefined ? { cloudLinkEnabled } : {}),
        ...(currency ? { currency } : {}),
        ...(taxRegion ? { taxRegion } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentUrl ? { paymentUrl } : {}),
        ...(qrEnabled !== undefined ? { qrEnabled } : {}),
        ...(qrDescription ? { qrDescription } : {}),
        ...(amountInWords !== undefined ? { amountInWords } : {}),
        ...(template ? { template } : {}),
        ...(invoiceType ? { invoiceType } : {}),
      });
      return { invoice, taskCount, expenseCount };
    }),
  );

  tool(
    "send_invoice",
    "Mark an invoice SENT. This is the point of no return for billing state — source tasks/expenses get marked billed. Only send after the client has reviewed the draft. dryRun previews the billed-marking without mutating.",
    {
      id: z.string().describe("Invoice id."),
      dryRun: z.boolean().optional().describe("Preview only; the invoice stays a draft."),
    },
    safe(async ({ id, dryRun }) => api.sendInvoice(id, { dryRun })),
  );

  tool(
    "mark_invoice_paid",
    "Mark an invoice PAID. Only call when payment is confirmed. dryRun previews without mutating.",
    {
      id: z.string().describe("Invoice id."),
      dryRun: z.boolean().optional().describe("Preview only."),
    },
    safe(async ({ id, dryRun }) => api.markInvoicePaid(id, { dryRun })),
  );

  tool(
    "list_recurring_schedules",
    "List recurring invoice draft schedules. Sending is always a separate action.",
    { status: z.string().optional().describe("Filter: active|paused|ended.") },
    safe(async ({ status }) => {
      let s = (await api.listSchedules({ all: true })) as any[];
      if (status) s = s.filter((x) => x.status === status);
      return s;
    }),
  );

  tool(
    "create_recurring_schedule",
    "Create recurring drafts, never send/pay. Fixed mode needs lineItems. Starts at startDate. Unattended execution needs an external authenticated runner.",
    {
      clientId: z.string(),
      name: z.string().describe("Schedule name, e.g. 'Monthly retainer'."),
      frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
      interval: z.number().int().min(1).optional().describe("Every N periods (default 1)."),
      mode: z.enum(["fixed", "unbilled"]).optional().describe("Default 'fixed'."),
      projectId: z.string().optional(),
      lineItems: z
        .array(
          z.object({ description: z.string(), quantity: z.number(), rate: z.number() }),
        )
        .optional()
        .describe("Required for mode 'fixed'. Dollars."),
      startDate: dateArg("First run date (default today)."),
      maxOccurrences: z.number().int().min(1).optional().describe("Stop after N runs."),
      dryRun: z.boolean().optional().describe("Validate the configuration and references without creating a schedule"),
    },
    safe(async (a) => {
      const mode = a.mode ?? "fixed";
      if (mode === "fixed" && !a.lineItems)
        throw new Error("mode 'fixed' requires lineItems.");
      const start = a.startDate ? parseDate(a.startDate) : Date.now();
      return api.createSchedule({
        clientId: a.clientId,
        projectId: a.projectId || undefined,
        name: a.name,
        mode,
        frequency: a.frequency,
        interval: a.interval ?? 1,
        lineItems: a.lineItems?.map((it: any) => ({
          description: it.description,
          quantity: it.quantity,
          rate: it.rate,
        })) ?? [],
        startDate: start,
        nextRunAt: start,
        maxOccurrences: a.maxOccurrences,
        status: "active",
      }, { dryRun: a.dryRun });
    }),
  );

  tool(
    "run_recurring_schedules",
    "Force-run due schedules now (or one schedule by id). Creating a schedule does not provision server cron. The open web app periodically checks due schedules; an external authenticated runner is required for unattended execution while it is closed. This creates drafts only, never sends them. dryRun previews what would be generated without creating invoices.",
    {
      scheduleId: z.string().optional().describe("Run one schedule only."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is created."),
    },
    safe(async ({ scheduleId, dryRun }) =>
      scheduleId
        ? api.runSchedule(scheduleId, { dryRun })
        : api.runScheduler({ dryRun }),
    ),
  );

  tool(
    "list_retainers",
    "List client retainers (prepaid hour blocks / monthly fees).",
    { clientId: z.string().optional() },
    safe(async ({ clientId }) =>
      api.listRetainers({ all: true, clientId }),
    ),
  );

  tool(
    "create_retainer",
    "Create a retainer. amountCents is integer CENTS (600000 = $6,000) — the one money field that is not dollars. totalHours for prepaid-hours blocks.",
    {
      clientId: z.string(),
      name: z.string(),
      type: z.enum(["prepaid-hours", "monthly-fee"]),
      totalHours: z.number().optional(),
      amountCents: z.number().int().optional().describe("Integer cents, e.g. 600000 = $6,000."),
      startDate: dateArg("Start date (default today)."),
    },
    safe(async (a) =>
      api.createRetainer({
        clientId: a.clientId,
        name: a.name,
        type: a.type,
        totalHours: a.totalHours,
        amountCents: a.amountCents,
        startDate: a.startDate ? parseDate(a.startDate) : Date.now(),
        status: "active",
      }),
    ),
  );

  tool(
    "update_client",
    "Update a client (name, email, defaultRate, notes, archived). Pass only the fields to change.",
    {
      id: z.string().describe("Client id."),
      name: z.string().optional(),
      email: z.string().optional(),
      defaultRate: z.number().optional().describe("Dollars/hour."),
      notes: z.string().optional(),
      archived: z.boolean().optional(),
    },
    safe(async ({ id, ...patch }) => api.updateClient(id, patch)),
  );

  tool(
    "delete_client",
    "Delete a client. Refused (409) while it still has projects or invoices — delete those first or archive it (update_client with archived: true). dryRun previews without deleting.",
    {
      id: z.string().describe("Client id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteClient(id, { dryRun })),
  );

  tool(
    "get_project",
    "Fetch one project by id.",
    { id: z.string().describe("Project id.") },
    safe(async ({ id }) => api.getProject(id)),
  );

  tool(
    "update_project",
    "Update a project (name, clientId, rateOverride, archived). Pass only the fields to change.",
    {
      id: z.string().describe("Project id."),
      name: z.string().optional(),
      clientId: z.string().optional().describe("Move the project to another client."),
      rateOverride: z.number().optional().describe("Dollars/hour."),
      archived: z.boolean().optional(),
    },
    safe(async ({ id, ...patch }) => api.updateProject(id, patch)),
  );

  tool(
    "delete_project",
    "Delete a project. Refused (409) while it still has tasks or expenses — archive it instead. dryRun previews without deleting.",
    {
      id: z.string().describe("Project id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteProject(id, { dryRun })),
  );

  tool(
    "list_tasks",
    "List time entries with filters. Use this to inspect/correct entries (e.g. find last week's entries to fix), or to feed bulk analysis. Sort with e.g. '-startAt'.",
    {
      projectId: z.string().optional(),
      clientId: z.string().optional(),
      isBilled: z.boolean().optional().describe("Filter billed/unbilled entries."),
      dateFrom: dateArg("Only entries starting on/after this day."),
      dateTo: dateArg("Only entries starting on/before this day."),
      sort: z.string().optional().describe("Sort field, prefix '-' for desc. One of: startAt, endAt, durationMinutes, name, createdAt."),
    },
    safe(async (a) =>
      api.listTasks({
        all: true,
        projectId: a.projectId,
        clientId: a.clientId,
        isBilled: a.isBilled,
        date_from: a.dateFrom ? parseDate(a.dateFrom) : undefined,
        date_to: a.dateTo ? parseDate(a.dateTo) : undefined,
        sort: a.sort,
      }),
    ),
  );

  tool(
    "get_task",
    "Fetch one time entry by id.",
    { id: z.string().describe("Task id.") },
    safe(async ({ id }) => api.getTask(id)),
  );

  tool(
    "update_task",
    "Fix a time entry: minutes rewrites duration (and endAt from startAt), date moves it to another day keeping duration. Pass only the fields to change.",
    {
      id: z.string().describe("Task id."),
      minutes: z.number().optional().describe("New duration in minutes."),
      date: dateArg("Move the entry to this day (keeps duration)."),
      note: z.string().optional().describe("New note."),
      projectId: z.string().optional().describe("Move to another project."),
      isBilled: z.boolean().optional(),
    },
    safe(async ({ id, minutes, date, note, projectId, isBilled }) => {
      const patch: Record<string, unknown> = {};
      if (minutes !== undefined) {
        if (!(minutes > 0)) throw new Error("minutes must be positive.");
        const existing = (await api.getTask(id)) as any;
        patch.durationMinutes = round2(minutes);
        patch.endAt = existing.startAt + Math.round(minutes * 60000);
      }
      if (date !== undefined) {
        const day = parseDate(date);
        const existing = (await api.getTask(id)) as any;
        const durMs = (existing.endAt || Date.now()) - existing.startAt;
        patch.startAt = day;
        if (existing.endAt) patch.endAt = day + durMs;
      }
      if (note !== undefined) patch.notes = note;
      if (projectId !== undefined) patch.projectId = projectId;
      if (isBilled !== undefined) patch.isBilled = isBilled;
      return api.updateTask(id, patch);
    }),
  );

  tool(
    "delete_task",
    "Delete one unbilled time-entry record by id. dryRun=true previews only. Billed entries are rejected; this tool does not delete invoices.",
    {
      id: z.string().describe("Task id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteTask(id, { dryRun })),
  );

  tool(
    "list_expenses",
    "List expenses with filters. Sort with e.g. '-date' or '-amount'.",
    {
      clientId: z.string().optional(),
      projectId: z.string().optional(),
      category: z.string().optional(),
      isBilled: z.boolean().optional().describe("Filter billed/unbilled expenses."),
      dateFrom: dateArg("Only expenses on/after this day."),
      dateTo: dateArg("Only expenses on/before this day."),
      sort: z.string().optional().describe("Sort field, prefix '-' for desc. One of: date, amount, category, createdAt."),
    },
    safe(async (a) =>
      api.listExpenses({
        all: true,
        clientId: a.clientId,
        projectId: a.projectId,
        category: a.category,
        isBilled: a.isBilled,
        date_from: a.dateFrom ? parseDate(a.dateFrom) : undefined,
        date_to: a.dateTo ? parseDate(a.dateTo) : undefined,
        sort: a.sort,
      }),
    ),
  );

  tool(
    "get_expense",
    "Fetch one expense by id.",
    { id: z.string().describe("Expense id.") },
    safe(async ({ id }) => api.getExpense(id)),
  );

  tool(
    "update_expense",
    "Update an expense (amount, category, note, date, clientId, projectId). Pass only the fields to change.",
    {
      id: z.string().describe("Expense id."),
      amount: z.number().optional().describe("Dollars."),
      category: z.string().optional(),
      note: z.string().optional(),
      date: dateArg("Expense date."),
      clientId: z.string().optional(),
      projectId: z.string().optional(),
    },
    safe(async ({ id, amount, date, ...rest }) => {
      const patch: Record<string, unknown> = { ...rest };
      if (amount !== undefined) {
        if (!(amount > 0)) throw new Error("amount must be positive (dollars).");
        patch.amount = round2(amount);
      }
      if (date !== undefined) patch.date = parseDate(date);
      return api.updateExpense(id, patch);
    }),
  );

  tool(
    "delete_expense",
    "Delete one unbilled expense record by id. dryRun=true previews only. Billed expenses are rejected; this tool does not delete invoices.",
    {
      id: z.string().describe("Expense id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteExpense(id, { dryRun })),
  );

  tool(
    "update_invoice",
    "Edit invoice fields; may overwrite content. cloudLinkEnabled controls public links; returns shareUrl/pdfUrl. No status changes or money transfers.",
    {
      id: z.string().describe("Invoice id."),
      notes: z.string().optional(),
      dueDate: dateArg("New due date."),
      invoiceNumber: z.string().optional(),
      clientId: z.string().optional(),
      issueDate: dateArg("Issue date."),
      currency: z.string().optional(),
      paymentMethod: z.string().optional(),
      template: z.enum(["default", "stripe"]).optional(),
      cloudLinkEnabled: z.boolean().optional(),
      lineItems: z.array(z.object({
        id: z.string().optional(), description: z.string(), quantity: z.number().nonnegative(), rate: z.number().nonnegative(),
        sourceType: z.enum(["task", "expense", "manual"]).optional(), sourceId: z.string().optional(),
        taxRate: z.number().min(0).max(100).optional(), taxLabel: z.string().optional(),
      })).optional().describe("Replace all lines; retain sourceType/sourceId for tracked work."),
    },
    safe(async ({ id, dueDate, issueDate, ...rest }) =>
      api.updateInvoice(id, {
        ...rest,
        ...(dueDate !== undefined ? { dueDate: parseDate(dueDate) } : {}),
        ...(issueDate !== undefined ? { issueDate: parseDate(issueDate) } : {}),
      }),
    ),
  );

  tool(
    "delete_invoice",
    "Delete a DRAFT invoice. Refused (409) once sent or paid — the money trail is kept. dryRun previews without deleting.",
    {
      id: z.string().describe("Invoice id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteInvoice(id, { dryRun })),
  );

  tool(
    "get_recurring_schedule",
    "Fetch one recurring schedule by id.",
    { id: z.string().describe("Schedule id.") },
    safe(async ({ id }) => api.getSchedule(id)),
  );

  tool(
    "update_recurring_schedule",
    "Update a schedule (name, status, notes). Use status 'paused' to temporarily stop billing without deleting.",
    {
      id: z.string().describe("Schedule id."),
      name: z.string().optional(),
      status: z.enum(["active", "paused", "ended"]).optional(),
      notes: z.string().optional(),
    },
    safe(async ({ id, ...patch }) => api.updateSchedule(id, patch)),
  );

  tool(
    "delete_recurring_schedule",
    "Delete a recurring schedule. dryRun previews without deleting.",
    {
      id: z.string().describe("Schedule id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteSchedule(id, { dryRun })),
  );

  tool(
    "get_retainer",
    "Fetch one retainer by id.",
    { id: z.string().describe("Retainer id.") },
    safe(async ({ id }) => api.getRetainer(id)),
  );

  tool(
    "update_retainer",
    "Update a retainer (name, status, notes).",
    {
      id: z.string().describe("Retainer id."),
      name: z.string().optional(),
      status: z.enum(["active", "paused", "depleted", "ended"]).optional(),
      notes: z.string().optional(),
    },
    safe(async ({ id, ...patch }) => api.updateRetainer(id, patch)),
  );

  tool(
    "delete_retainer",
    "Delete a retainer. dryRun previews without deleting.",
    {
      id: z.string().describe("Retainer id."),
      dryRun: z.boolean().optional().describe("Preview only; nothing is deleted."),
    },
    safe(async ({ id, dryRun }) => api.deleteRetainer(id, { dryRun })),
  );

  tool(
    "list_overdue_invoices",
    "Invoices that are SENT but past their due date — the follow-up list. Optionally scoped to one client.",
    {
      clientId: z.string().optional().describe("Scope to one client."),
    },
    safe(async ({ clientId }) =>
      api.listInvoices({ all: true, overdue: true, clientId }),
    ),
  );

  tool(
    "revenue_summary",
    "Monthly revenue summary: paid invoices issued in YYYY-MM, with totals and per-client breakdown. Dollars.",
    {
      month: z.string().describe('Month as "YYYY-MM", e.g. "2026-09".'),
      clientId: z.string().optional().describe("Scope to one client."),
    },
    safe(async ({ month, clientId }) => {
      const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12)
        throw new Error('month must be "YYYY-MM", e.g. "2026-09".');
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
      const end = Date.UTC(Number(m[1]), Number(m[2]), 1);
      const invoices = (await api.listInvoices({
        all: true,
        status: "paid",
        date_from: start,
        date_to: end - 1,
        clientId,
      })) as any[];
      const byClient = new Map<string, { count: number; total: number }>();
      for (const inv of invoices) {
        const row = byClient.get(inv.clientId) ?? { count: 0, total: 0 };
        row.count += 1;
        row.total = round2(row.total + (inv.total ?? 0));
        byClient.set(inv.clientId, row);
      }
      return {
        month,
        invoices: invoices.length,
        revenue: round2(invoices.reduce((s, i) => s + (i.total ?? 0), 0)),
        byClient: [...byClient.entries()].map(([cid, r]) => ({ clientId: cid, ...r })),
      };
    }),
  );

  tool(
    "get_settings",
    "Read server settings (business profile, invoice numbering, payment terms). Useful for due-date math and invoice prefixes.",
    {},
    safe(async () => api.getSettings()),
  );

  tool(
    "update_settings",
    "Patch server settings, e.g. { invoice: { paymentTermsDays: 30 } } or { business: { name: 'Acme Consulting' } }. Nested objects merge key-wise.",
    {
      patch: settingsPatchSchema.describe("Writable settings only. Nested fields merge. Validation is atomic."),
      dryRun: z.boolean().optional().describe("Validate without saving changes"),
    },
    safe(async ({ patch, dryRun }) => api.updateSettings(patch, { dryRun })),
  );

  server.registerResource(
    "guide",
    "tally://guide",
    {
      mimeType: "text/markdown",
      description:
        "Agent playbook: auth, money/time conventions, open-timer representation, idempotency, and the standard track-then-bill workflow. Read this before driving Tallyhand.",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: GUIDE },
      ],
    }),
  );

  registerWorkspaceFeatures(server, api, options);
  registerExtendedTools(server, api, options);
  registerAgentSkills(server);
  server.installToolCatalog(observeCatalog);
  return server;
}

export async function runMcpServer(api: Api): Promise<void> {
  serveStdio(() => createMcpServer(api), { legacy: "serve" });
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("/dist/mcp.js") || entry.endsWith("dist\\mcp.js") || entry.endsWith("/src/mcp.ts")) {
  const { resolveConfig } = await import("./client.js");
  const { TallyhandClient } = await import("./client.js");
  const cfg = resolveConfig({});
  await runMcpServer(new TallyhandClient(cfg));
}
