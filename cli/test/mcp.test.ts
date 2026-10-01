import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { ApiError } from "../src/client.js";

import { CLI_MCP_PARITY } from "../src/mcp-parity.js";
const EXPECTED_TOOLS = [
  "export_data", "export_workspace_backup", "import_workspace", "reset_workspace",
  "health_check",
  "list_clients",
  "create_client",
  "get_client",
  "update_client",
  "delete_client",
  "list_projects",
  "create_project",
  "get_project",
  "update_project",
  "delete_project",
  "timer_start",
  "timer_stop",
  "timer_status",
  "log_time",
  "bulk_log_time",
  "list_unbilled",
  "log_expense",
  "bulk_log_expenses",
  "list_tasks",
  "get_task",
  "update_task",
  "delete_task",
  "list_expenses",
  "get_expense",
  "update_expense",
  "delete_expense",
  "list_invoices",
  "get_invoice",
  "create_invoice_draft",
  "update_invoice",
  "delete_invoice",
  "list_overdue_invoices",
  "send_invoice",
  "mark_invoice_paid",
  "list_recurring_schedules",
  "create_recurring_schedule",
  "get_recurring_schedule",
  "update_recurring_schedule",
  "delete_recurring_schedule",
  "run_recurring_schedules",
  "list_retainers",
  "create_retainer",
  "get_retainer",
  "update_retainer",
  "delete_retainer",
  "revenue_summary",
  "get_settings",
  "update_settings",
];

for (const name of Object.values(CLI_MCP_PARITY)) if (!EXPECTED_TOOLS.includes(name)) EXPECTED_TOOLS.push(name);

function fakeApi() {
  return {
    hasToken: true,
    health: async () => ({ status: "ok", version: "0.1.0" }),
    listClients: async () => [{ id: "c1", name: "Acme" }],
    createClient: async (i: any) => ({ id: "c1", ...i }),
    getClient: async (id: string) => ({ id, name: "Acme" }),
    updateClient: async (id: string, p: any) => ({ id, ...p }),
    deleteClient: async (id: string) => ({ deleted: id }),
    listProjects: async () => [],
    createProject: async (i: any) => ({ id: "p1", ...i }),
    getProject: async (id: string) => ({ id }),
    updateProject: async (id: string, p: any) => ({ id, ...p }),
    deleteProject: async (id: string) => ({ deleted: id }),
    listTasks: async () => {
      throw new ApiError(401, "unauthorized", "bad token");
    },
    createTask: async (i: any) => ({ id: "t1", ...i }),
    getTask: async (id: string) => ({ id }),
    updateTask: async (id: string, p: any) => ({ id, ...p }),
    deleteTask: async (id: string) => ({ deleted: id }),
    bulkCreateTasks: async (items: any[]) => ({ created: items.map((i, n) => ({ id: `t${n}`, ...i })) }),
    bulkCreateExpenses: async (items: any[]) => ({ created: items.map((i, n) => ({ id: `e${n}`, ...i })) }),
    listExpenses: async () => [],
    createExpense: async (i: any) => ({ id: "e1", ...i }),
    getExpense: async (id: string) => ({ id }),
    updateExpense: async (id: string, p: any) => ({ id, ...p }),
    deleteExpense: async (id: string) => ({ deleted: id }),
    listInvoices: async () => [],
    createInvoice: async (i: any) => ({ id: "inv1", ...i }),
    getInvoice: async (id: string) => ({ id }),
    updateInvoice: async (id: string, p: any) => ({ id, ...p }),
    deleteInvoice: async (id: string) => ({ deleted: id }),
    sendInvoice: async (id: string) => ({ id, status: "sent" }),
    markInvoicePaid: async (id: string) => ({ id, status: "paid" }),
    listSchedules: async () => [],
    createSchedule: async (i: any) => ({ id: "s1", ...i }),
    getSchedule: async (id: string) => ({ id }),
    updateSchedule: async (id: string, p: any) => ({ id, ...p }),
    deleteSchedule: async (id: string) => ({ deleted: id }),
    runSchedule: async (id: string) => ({ ran: id }),
    runScheduler: async () => ({ ran: 2 }),
    listRetainers: async () => [],
    createRetainer: async (i: any) => ({ id: "r1", ...i }),
    getRetainer: async (id: string) => ({ id }),
    updateRetainer: async (id: string, p: any) => ({ id, ...p }),
    deleteRetainer: async (id: string) => ({ deleted: id }),
    getSettings: async () => ({ id: "singleton" }),
    updateSettings: async (p: any) => p,
  };
}

async function connectedClient(api: any) {
  const server = createMcpServer(api);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

describe("MCP server", () => {
  it("registers every expected workspace tool", async () => {
    const client = await connectedClient(fakeApi());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(EXPECTED_TOOLS.length);
  });

  it("every tool has a description and an input schema", async () => {
    const client = await connectedClient(fakeApi());
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.inputSchema, t.name).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("exposes the tally://guide resource", async () => {
    const client = await connectedClient(fakeApi());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("tally://guide");
    const guide = resources.find((r) => r.uri === "tally://guide")!;
    expect(guide.mimeType).toBe("text/markdown");
  });

  it("health_check returns JSON content", async () => {
    const client = await connectedClient(fakeApi());
    const res: any = await client.callTool({ name: "health_check", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ status: "ok" });
  });

  it("maps ApiError to isError content", async () => {
    const client = await connectedClient(fakeApi());
    const res: any = await client.callTool({ name: "timer_status", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unauthorized/);
  });

  it("create_client passes args through", async () => {
    const client = await connectedClient(fakeApi());
    const res: any = await client.callTool({
      name: "create_client",
      arguments: { name: "Acme", defaultRate: 150 },
    });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ name: "Acme", defaultRate: 150 });
  });
});
