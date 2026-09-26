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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiError } from "./client.js";
import {
  parseDate,
  round2,
} from "./format.js";
import {
  collectUnbilled,
  buildUnbilledLineItems,
  invoiceTotals,
  computeLineAmount,
} from "./billing.js";
import { findOpenTimers, type Api } from "./commands.js";
import { GUIDE } from "./guide.js";

export const MCP_VERSION = "0.1.0";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : "error";
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Error ${code}: ${message}` }],
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
  z.string().optional().describe(desc + " Format: YYYY-MM-DD (local midnight).");

const moneyNote =
  "Amounts are dollars (e.g. 42.50), matching the Tallyhand domain.";

export function createMcpServer(api: Api): McpServer {
  const server = new McpServer({ name: "tallyhand", version: MCP_VERSION });

  server.tool(
    "health_check",
    "Check that the Tallyhand server is reachable. No auth required. Run this first when anything else fails — it distinguishes 'server down' from 'bad token'.",
    {},
    safe(async () => api.health()),
  );

  server.tool(
    "list_clients",
    "List clients. Use before anything client-scoped to resolve names to ids. Archived clients are hidden unless includeArchived is true.",
    {
      includeArchived: z.boolean().optional().describe("Include archived clients."),
    },
    safe(async ({ includeArchived }) => {
      let clients = (await api.listClients({ all: true })) as any[];
      if (!includeArchived) clients = clients.filter((c) => !c.archived);
      return clients;
    }),
  );

  server.tool(
    "create_client",
    "Create a client. defaultRate is the hourly rate in DOLLARS used for unbilled-amount math when a project has no override.",
    {
      name: z.string().describe("Client name."),
      email: z.string().optional().describe("Contact email."),
      defaultRate: z.number().optional().describe("Default hourly rate in dollars."),
    },
    safe(async (a) => api.createClient(a)),
  );

  server.tool(
    "get_client",
    "Fetch one client by id.",
    { id: z.string().describe("Client id.") },
    safe(async ({ id }) => api.getClient(id)),
  );

  server.tool(
    "list_projects",
    "List projects, optionally filtered by client. Resolve project names to ids here before starting timers or logging time.",
    { clientId: z.string().optional().describe("Filter to one client.") },
    safe(async ({ clientId }) => {
      let projects = (await api.listProjects({ all: true })) as any[];
      if (clientId) projects = projects.filter((p) => p.clientId === clientId);
      return projects;
    }),
  );

  server.tool(
    "create_project",
    "Create a project under a client. rateOverride (dollars/hour) beats the client's defaultRate for this project.",
    {
      clientId: z.string().describe("Owning client id."),
      name: z.string().describe("Project name."),
      rateOverride: z.number().optional().describe("Hourly rate in dollars."),
    },
    safe(async (a) => api.createProject(a)),
  );

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
    "list_unbilled",
    "Unbilled work grouped by client/project with hours and dollar amounts. Amounts use project.rateOverride ?? client.defaultRate. Review this before drafting an invoice.",
    {
      clientId: z.string().optional(),
      projectId: z.string().optional(),
    },
    safe(async (a) => collectUnbilled(api, a)),
  );

  server.tool(
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

  server.tool(
    "list_invoices",
    "List invoices, optionally filtered by status and/or client.",
    {
      status: z.enum(["draft", "sent", "paid"]).optional(),
      clientId: z.string().optional(),
    },
    safe(async (a) => api.listInvoices({ all: true, ...a })),
  );

  server.tool(
    "get_invoice",
    "Fetch one invoice with its line items, totals, and public-link token.",
    { id: z.string().describe("Invoice id.") },
    safe(async ({ id }) => api.getInvoice(id)),
  );

  server.tool(
    "create_invoice_draft",
    "Create a DRAFT invoice — safe, nothing is billed until send_invoice. Either pass explicit items (array of {description, quantity, rate} in dollars) or omit items to auto-build from the client's unbilled tasks + expenses.",
    {
      clientId: z.string().describe("Client id."),
      projectId: z.string().optional().describe("Scope auto-build to one project."),
      items: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number(),
            rate: z.number(),
          }),
        )
        .optional()
        .describe("Explicit line items (dollars). Omit to build from unbilled work."),
    },
    safe(async ({ clientId, projectId, items }) => {
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
        }));
      } else {
        const built = await buildUnbilledLineItems(api, { clientId, projectId });
        if (built.lineItems.length === 0)
          throw new Error("Nothing unbilled for this client.");
        lineItems = built.lineItems;
        taskCount = built.taskCount;
        expenseCount = built.expenseCount;
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
      return { invoice, taskCount, expenseCount };
    }),
  );

  server.tool(
    "send_invoice",
    "Mark an invoice SENT. This is the point of no return for billing state — source tasks/expenses get marked billed. Only send after the client has reviewed the draft.",
    { id: z.string().describe("Invoice id.") },
    safe(async ({ id }) => api.sendInvoice(id)),
  );

  server.tool(
    "mark_invoice_paid",
    "Mark an invoice PAID. Only call when payment is confirmed.",
    { id: z.string().describe("Invoice id.") },
    safe(async ({ id }) => api.markInvoicePaid(id)),
  );

  server.tool(
    "list_recurring_schedules",
    "List recurring invoice schedules (auto-billing templates).",
    { status: z.string().optional().describe("Filter: active|paused|ended.") },
    safe(async ({ status }) => {
      let s = (await api.listSchedules({ all: true })) as any[];
      if (status) s = s.filter((x) => x.status === status);
      return s;
    }),
  );

  server.tool(
    "create_recurring_schedule",
    "Create an auto-billing schedule. mode 'fixed' invoices the same lineItems every period; mode 'unbilled' sweeps the client's unbilled work each run. nextRunAt starts at startDate.",
    {
      clientId: z.string(),
      name: z.string().describe("Schedule name, e.g. 'Monthly retainer'."),
      frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
      interval: z.number().optional().describe("Every N periods (default 1)."),
      mode: z.enum(["fixed", "unbilled"]).optional().describe("Default 'fixed'."),
      projectId: z.string().optional(),
      lineItems: z
        .array(
          z.object({ description: z.string(), quantity: z.number(), rate: z.number() }),
        )
        .optional()
        .describe("Required for mode 'fixed'. Dollars."),
      startDate: dateArg("First run date (default today)."),
      maxOccurrences: z.number().optional().describe("Stop after N runs."),
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
          amount: computeLineAmount(it.quantity, it.rate),
          sourceType: "manual",
        })),
        startDate: start,
        nextRunAt: start,
        maxOccurrences: a.maxOccurrences,
        status: "active",
      });
    }),
  );

  server.tool(
    "run_recurring_schedules",
    "Force-run due schedules now (or one schedule by id). The server scheduler also runs these automatically; use this to bill immediately.",
    { scheduleId: z.string().optional().describe("Run one schedule only.") },
    safe(async ({ scheduleId }) =>
      scheduleId ? api.runSchedule(scheduleId) : api.runScheduler(),
    ),
  );

  server.tool(
    "list_retainers",
    "List client retainers (prepaid hour blocks / monthly fees).",
    { clientId: z.string().optional() },
    safe(async ({ clientId }) =>
      api.listRetainers({ all: true, clientId }),
    ),
  );

  server.tool(
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

  server.tool(
    "get_settings",
    "Read server settings (business profile, invoice numbering, payment terms). Useful for due-date math and invoice prefixes.",
    {},
    safe(async () => api.getSettings()),
  );

  server.resource(
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

  return server;
}

export async function runMcpServer(api: Api): Promise<void> {
  const server = createMcpServer(api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("/dist/mcp.js") || entry.endsWith("dist\\mcp.js") || entry.endsWith("/src/mcp.ts")) {
  const { resolveConfig } = await import("./client.js");
  const { TallyhandClient } = await import("./client.js");
  const cfg = resolveConfig({});
  await runMcpServer(new TallyhandClient(cfg));
}
