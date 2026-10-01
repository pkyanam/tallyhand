import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProgram } from "../src/cli.js";
import {
  handleTimerStart,
  handleTimerStop,
  handleTimerStatus,
  handleLog,
  handleInvoiceDraft,
  handleInvoiceList,
  handleInvoiceShow,
  handleInvoiceUpdate,
  handleInvoiceDelete,
  handleClientShow,
  handleClientUpdate,
  handleClientDelete,
  handleProjectShow,
  handleProjectUpdate,
  handleProjectDelete,
  handleTasksList,
  handleTaskShow,
  handleTaskUpdate,
  handleTaskDelete,
  handleExpensesList,
  handleExpenseShow,
  handleExpenseUpdate,
  handleExpenseDelete,
  handleRecurringShow,
  handleRecurringUpdate,
  handleRecurringDelete,
  handleRecurringRun,
  handleRetainerShow,
  handleRetainerUpdate,
  handleRetainerDelete,
  handleSettingsShow,
  handleSettingsSet,
  handleReportRevenue,
  handleTasksBulk,
  handleExpensesBulk,
  type Api,
} from "../src/commands.js";

/** Minimal fake Api recording calls. */
function fakeApi(overrides: Record<string, any> = {}): Api & { calls: any[] } {
  const calls: any[] = [];
  const base: any = {
    hasToken: true,
    calls,
    health: async () => ({ status: "ok" }),
    listClients: async () => [],
    createClient: async (i: any) => ({ id: "c1", ...i }),
    getClient: async (id: string) => ({ id, name: "Acme" }),
    listProjects: async () => [],
    createProject: async (i: any) => ({ id: "p1", ...i }),
    getProject: async (id: string) => ({ id, name: "Website", clientId: "c1" }),
    listTasks: async () => [],
    createTask: async (i: any) => {
      calls.push(["createTask", i]);
      return { id: "t1", ...i };
    },
    updateTask: async (id: string, p: any) => {
      calls.push(["updateTask", id, p]);
      return { id, ...p };
    },
    listExpenses: async () => [],
    createExpense: async (i: any) => ({ id: "e1", ...i }),
    getExpense: async (id: string) => ({ id, amount: 1000, category: "travel" }),
    updateExpense: async (id: string, p: any) => {
      calls.push(["updateExpense", id, p]);
      return { id, ...p };
    },
    deleteExpense: async (id: string, o: any) => ({ id, ...o }),
    listInvoices: async () => [],
    createInvoice: async (i: any) => {
      calls.push(["createInvoice", i]);
      return { id: "inv1", invoiceNumber: "INV-1001", ...i };
    },
    getInvoice: async (id: string) => ({ id }),
    updateInvoice: async (id: string, p: any) => {
      calls.push(["updateInvoice", id, p]);
      return { id, ...p };
    },
    deleteInvoice: async (id: string, o: any) => ({ id, ...o }),
    sendInvoice: async (id: string, o: any) => ({ id, status: "sent", ...o }),
    markInvoicePaid: async (id: string, o: any) => ({ id, status: "paid", ...o }),
    listSchedules: async () => [],
    createSchedule: async (i: any) => ({ id: "s1", ...i }),
    getSchedule: async (id: string) => ({ id, name: "Monthly" }),
    updateSchedule: async (id: string, p: any) => {
      calls.push(["updateSchedule", id, p]);
      return { id, ...p };
    },
    deleteSchedule: async (id: string, o: any) => ({ id, ...o }),
    runSchedule: async (id: string, o: any) => ({ ran: id, ...o }),
    runScheduler: async (o: any) => ({ ran: 0, ...o }),
    listRetainers: async () => [],
    createRetainer: async (i: any) => ({ id: "r1", ...i }),
    getRetainer: async (id: string) => ({ id, name: "Retainer", amountCents: 10000 }),
    updateRetainer: async (id: string, p: any) => {
      calls.push(["updateRetainer", id, p]);
      return { id, ...p };
    },
    deleteRetainer: async (id: string, o: any) => ({ id, ...o }),
    getSettings: async () => ({}),
    updateSettings: async (p: any) => {
      calls.push(["updateSettings", p]);
      return p;
    },
    updateClient: async (id: string, p: any) => {
      calls.push(["updateClient", id, p]);
      return { id, ...p };
    },
    deleteClient: async (id: string, o: any) => ({ id, ...o }),
    updateProject: async (id: string, p: any) => {
      calls.push(["updateProject", id, p]);
      return { id, ...p };
    },
    deleteProject: async (id: string, o: any) => ({ id, ...o }),
    getTask: async (id: string) => ({ id, startAt: 1000, endAt: 4600000, durationMinutes: 76 }),
    deleteTask: async (id: string, o: any) => ({ id, ...o }),
    deleteBulkTasks: async (i: any) => ({ items: i }),
    deleteBulkExpenses: async (i: any) => ({ items: i }),
  };
  return Object.assign(base, overrides);
}

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
    logs.push(a.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("command registration (parse smoke)", () => {
  const program = buildProgram();
  const find = (path: string[]) => {
    let cmds = program.commands;
    let cmd: any;
    for (const name of path) {
      cmd = cmds.find((c: any) => c.name() === name);
      expect(cmd, `command ${path.join(" ")}`).toBeTruthy();
      cmds = cmd.commands;
    }
    return cmd;
  };
  const longs = (cmd: any) => cmd.options.map((o: any) => o.long);

  it("timer start/stop/status with expected flags", () => {
    expect(longs(find(["timer", "start"]))).toEqual(
      expect.arrayContaining(["--project", "--note", "--tags"]),
    );
    expect(longs(find(["timer", "stop"]))).toEqual(
      expect.arrayContaining(["--id", "--note"]),
    );
    find(["timer", "status"]);
  });

  it("log with expected flags", () => {
    expect(longs(find(["log"]))).toEqual(
      expect.arrayContaining(["--project", "--minutes", "--date", "--note", "--tags"]),
    );
  });

  it("invoice draft with expected flags", () => {
    expect(longs(find(["invoice", "draft"]))).toEqual(
      expect.arrayContaining(["--client", "--project", "--items"]),
    );
    expect(longs(find(["invoice", "list"]))).toEqual(
      expect.arrayContaining(["--overdue"]),
    );
    find(["invoice", "show"]);
    find(["invoice", "update"]);
    find(["invoice", "delete"]);
    expect(longs(find(["invoice", "send"]))).toEqual(
      expect.arrayContaining(["--dry-run"]),
    );
    expect(longs(find(["invoice", "paid"]))).toEqual(
      expect.arrayContaining(["--dry-run"]),
    );
  });

  it("recurring / retainer / expense / settings / report / export / config / doctor / mcp", () => {
    find(["recurring", "list"]);
    find(["recurring", "create"]);
    find(["recurring", "show"]);
    find(["recurring", "update"]);
    find(["recurring", "delete"]);
    expect(longs(find(["recurring", "run"]))).toEqual(
      expect.arrayContaining(["--dry-run"]),
    );
    find(["retainer", "list"]);
    find(["retainer", "create"]);
    find(["retainer", "show"]);
    find(["retainer", "update"]);
    find(["retainer", "delete"]);
    find(["expense", "add"]);
    find(["expense", "list"]);
    find(["expense", "show"]);
    find(["expense", "update"]);
    find(["expense", "delete"]);
    find(["settings", "show"]);
    find(["settings", "set"]);
    find(["report", "revenue"]);
    find(["export"]);
    find(["config", "set"]);
    find(["config", "show"]);
    find(["doctor"]);
    find(["mcp"]);
  });

  it("clients / projects / tasks subcommands wired", () => {
    find(["clients", "list"]);
    find(["clients", "show"]);
    find(["clients", "update"]);
    find(["clients", "delete"]);
    find(["projects", "list"]);
    find(["projects", "show"]);
    find(["projects", "update"]);
    find(["projects", "delete"]);
    find(["tasks", "list"]);
    find(["tasks", "show"]);
    find(["tasks", "update"]);
    find(["tasks", "delete"]);
    expect(longs(find(["tasks", "update"]))).toEqual(
      expect.arrayContaining(["--minutes", "--date", "--note", "--project"]),
    );
  });

  it("global --json / --api-url / --token flags exist", () => {
    expect(longs(program)).toEqual(
      expect.arrayContaining(["--json", "--api-url", "--token"]),
    );
  });
});

describe("timer handlers", () => {
  it("start creates an open task (endAt 0)", async () => {
    const api = fakeApi();
    const lookup = vi.spyOn(api, "getProject");
    await handleTimerStart(api, { project: "p1", note: "Design", tags: "a,b" }, { json: true });
    expect(lookup).not.toHaveBeenCalled();
    const [, input] = api.calls.find(([m]: any) => m === "createTask");
    expect(input.projectId).toBe("p1");
    expect(input.startAt).toBeGreaterThan(0);
    expect(input.endAt).toBe(0);
    expect(input.durationMinutes).toBe(0);
    expect(input.tags).toEqual(["a", "b"]);
    expect(JSON.parse(logs.join(""))).toMatchObject({ endAt: 0 });
  });

  it("stop errors with no running timer", async () => {
    const api = fakeApi({ listTasks: async () => [] });
    await expect(handleTimerStop(api, {}, { json: true })).rejects.toThrow("No running timer");
  });

  it("stop errors with N timers and tells you to pass --id", async () => {
    const api = fakeApi({
      listTasks: async () => [
        { id: "t1", startAt: 1, endAt: 0 },
        { id: "t2", startAt: 2, endAt: 0 },
      ],
    });
    await expect(handleTimerStop(api, {}, { json: true })).rejects.toThrow(
      /2 running timers — stop one via/,
    );
  });

  it("stop patches endAt + durationMinutes", async () => {
    const startAt = Date.now() - 90 * 60000;
    const api = fakeApi({
      listTasks: async () => [{ id: "t9", startAt, endAt: 0, name: "Work" }],
    });
    await handleTimerStop(api, {}, { json: false });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateTask");
    expect(id).toBe("t9");
    expect(patch.endAt).toBeGreaterThan(startAt);
    expect(patch.durationMinutes).toBe(90);
    expect(logs.join("")).toMatch(/Stopped/);
  });

  it("status reports 'No timer running.' when empty", async () => {
    const api = fakeApi({ listTasks: async () => [] });
    await handleTimerStatus(api, { json: false });
    expect(logs.join("")).toMatch(/No timer running/);
  });
});

describe("log handler", () => {
  it("creates a completed task with date math", async () => {
    const api = fakeApi();
    const lookup = vi.spyOn(api, "getProject");
    await handleLog(
      api,
      { project: "p1", minutes: 90, date: "2026-09-20", note: "Review" },
      { json: true },
    );
    expect(lookup).not.toHaveBeenCalled();
    const [, input] = api.calls.find(([m]: any) => m === "createTask");
    expect(input.durationMinutes).toBe(90);
    expect(input.endAt - input.startAt).toBe(90 * 60000);
    expect(new Date(input.startAt).toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("rejects non-positive minutes", async () => {
    const api = fakeApi();
    await expect(
      handleLog(api, { project: "p1", minutes: 0 }, { json: true }),
    ).rejects.toThrow("--minutes must be a positive number");
  });
});

describe("invoice draft handler", () => {
  it("builds from --items JSON", async () => {
    const api = fakeApi();
    await handleInvoiceDraft(
      api,
      {
        client: "c1",
        items: '[{"description":"Retainer","quantity":1,"rate":2000}]',
      },
      { json: true },
    );
    const [, input] = api.calls.find(([m]: any) => m === "createInvoice");
    expect(input.clientId).toBe("c1");
    expect(input.status).toBe("draft");
    expect(input.lineItems[0]).toMatchObject({
      description: "Retainer",
      quantity: 1,
      rate: 2000,
      amount: 2000,
    });
    expect(input.total).toBe(2000);
  });

  it("requires --client with --items", async () => {
    const api = fakeApi();
    await expect(
      handleInvoiceDraft(api, { items: "[]" }, { json: true }),
    ).rejects.toThrow("--client is required");
  });

  it("errors when nothing unbilled", async () => {
    const api = fakeApi({
      listTasks: async () => [],
      listExpenses: async () => [],
      listProjects: async () => [],
      listClients: async () => [{ id: "c1", name: "Acme" }],
    });
    await expect(
      handleInvoiceDraft(api, { client: "c1" }, { json: true }),
    ).rejects.toThrow("Nothing unbilled");
  });
});

describe("client show/update/delete handlers", () => {
  it("show prints the client", async () => {
    const api = fakeApi();
    await handleClientShow(api, "c1", { json: false });
    expect(logs.join("")).toMatch(/Acme/);
  });

  it("update passes only provided fields", async () => {
    const api = fakeApi();
    await handleClientUpdate(api, { id: "c1", name: "Beta" }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateClient");
    expect(id).toBe("c1");
    expect(patch).toEqual({ name: "Beta" });
  });

  it("update supports --archived / --no-archived explicitly", async () => {
    const api = fakeApi();
    await handleClientUpdate(api, { id: "c1", archived: true }, { json: true });
    let [, , patch] = api.calls.find(([m]: any) => m === "updateClient");
    expect(patch.archived).toBe(true);
    await handleClientUpdate(api, { id: "c1", archived: false }, { json: true });
    [, , patch] = api.calls.slice().reverse().find(([m]: any) => m === "updateClient");
    expect(patch.archived).toBe(false);
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteClient: async (id: string) => ({ dryRun: true, id, wouldDelete: { client: 1 } }) });
    await handleClientDelete(api, { id: "c1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("project show/update/delete handlers", () => {
  it("show prints the project", async () => {
    const api = fakeApi();
    await handleProjectShow(api, "p1", { json: false });
    expect(logs.join("")).toMatch(/Website/);
  });

  it("update moves rate override in dollars", async () => {
    const api = fakeApi();
    await handleProjectUpdate(api, { id: "p1", rate: 175 }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateProject");
    expect(id).toBe("p1");
    expect(patch).toEqual({ rateOverride: 175 });
  });

  it("delete passes dryRun", async () => {
    const api = fakeApi();
    await handleProjectDelete(api, { id: "p1", dryRun: true }, { json: true });
    expect(JSON.parse(logs.join(""))).toMatchObject({ dryRun: true });
  });
});

describe("task list/show/update/delete handlers", () => {
  it("list prints tasks", async () => {
    const api = fakeApi({
      listTasks: async () => [
        { id: "t1", name: "Design", startAt: 1, endAt: 2, durationMinutes: 90 },
      ],
    });
    await handleTasksList(api, {}, { json: false });
    expect(logs.join("")).toMatch(/Design/);
  });

  it("list forwards filters", async () => {
    const calls: any[] = [];
    const api = fakeApi({
      listTasks: async (o: any) => {
        calls.push(o);
        return [];
      },
    });
    await handleTasksList(
      api,
      { project: "p1", client: "c1", unbilled: true, from: "2026-09-01", to: "2026-09-30" },
      { json: true },
    );
    const opts = calls[0];
    expect(opts.projectId).toBe("p1");
    expect(opts.clientId).toBe("c1");
    expect(opts.isBilled).toBe(false);
    expect(opts.date_from).toBeGreaterThan(0);
    expect(opts.date_to).toBeGreaterThan(0);
  });

  it("show prints one task", async () => {
    const api = fakeApi();
    await handleTaskShow(api, "t1", { json: false });
    expect(logs.join("")).toMatch(/t1/);
  });

  it("update --minutes rewrites duration from the task start", async () => {
    const api = fakeApi({
      getTask: async (id: string) => ({ id, startAt: 1_000_000, endAt: 4_600_000, durationMinutes: 60 }),
    });
    await handleTaskUpdate(api, { id: "t1", minutes: 90 }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateTask");
    expect(id).toBe("t1");
    expect(patch.durationMinutes).toBe(90);
    expect(patch.endAt - 1_000_000).toBe(90 * 60000);
  });

  it("update --date moves the entry keeping duration", async () => {
    const api = fakeApi({
      getTask: async (id: string) => ({ id, startAt: 1_000_000, endAt: 4_600_000, durationMinutes: 60 }),
    });
    await handleTaskUpdate(api, { id: "t1", date: "2026-09-20" }, { json: true });
    const [, , patch] = api.calls.find(([m]: any) => m === "updateTask");
    expect(new Date(patch.startAt).toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(patch.endAt - patch.startAt).toBe(3_600_000);
  });

  it("update --note and --project map correctly", async () => {
    const api = fakeApi();
    await handleTaskUpdate(api, { id: "t1", note: "Fix", project: "p9" }, { json: true });
    const [, , patch] = api.calls.find(([m]: any) => m === "updateTask");
    expect(patch).toEqual({ notes: "Fix", projectId: "p9" });
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteTask: async (id: string) => ({ dryRun: true, id, wouldDelete: { task: 1 } }) });
    await handleTaskDelete(api, { id: "t1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("expense list/show/update/delete handlers", () => {
  it("list forwards filters and prints", async () => {
    const api = fakeApi({
      listExpenses: async (o: any) => {
        if (o.all && o.clientId === "c1" && o.isBilled === false)
          return [{ id: "e1", amount: 2500, category: "travel", date: 1 }];
        return [];
      },
    });
    await handleExpensesList(api, { client: "c1", unbilled: true }, { json: false });
    expect(logs.join("")).toMatch(/travel/);
  });

  it("update converts dollars and date", async () => {
    const api = fakeApi();
    await handleExpenseUpdate(api, { id: "e1", amount: 42.5, date: "2026-09-20", note: "Cab" }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateExpense");
    expect(id).toBe("e1");
    expect(patch.amount).toBe(42.5);
    expect(new Date(patch.date).toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(patch.note).toBe("Cab");
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteExpense: async (id: string) => ({ dryRun: true, id, wouldDelete: { expense: 1 } }) });
    await handleExpenseDelete(api, { id: "e1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("invoice update/delete handlers", () => {
  it("list forwards overdue flag", async () => {
    const api = fakeApi({ listInvoices: async (o: any) => (o.overdue ? [{ id: "i1" }] : []) });
    await handleInvoiceList(api, { overdue: true }, { json: false });
    expect(logs.join("")).toMatch(/i1/);
  });

  it("update maps due-date and number (status is not an accepted field)", async () => {
    const api = fakeApi();
    await handleInvoiceUpdate(api, { id: "i1", notes: "Net 30", dueDate: "2026-10-15", number: "INV-7" }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateInvoice");
    expect(id).toBe("i1");
    expect(patch.notes).toBe("Net 30");
    expect(patch.invoiceNumber).toBe("INV-7");
    expect(new Date(patch.dueDate).toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(patch).not.toHaveProperty("status");
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteInvoice: async (id: string) => ({ dryRun: true, id, wouldDelete: { invoice: 1 } }) });
    await handleInvoiceDelete(api, { id: "i1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("recurring show/update/delete/run handlers", () => {
  it("run forwards dryRun for scheduler and single schedule", async () => {
    const api = fakeApi();
    await handleRecurringRun(api, { dryRun: true }, { json: true });
    expect(JSON.parse(logs.join(""))).toMatchObject({ ran: 0, dryRun: true });
    logs = [];
    const api2 = fakeApi();
    await handleRecurringRun(api2, { id: "s1", dryRun: true }, { json: true });
    expect(JSON.parse(logs.join(""))).toMatchObject({ dryRun: true });
  });

  it("update passes status through", async () => {
    const api = fakeApi();
    await handleRecurringUpdate(api, { id: "s1", status: "paused" }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateSchedule");
    expect(id).toBe("s1");
    expect(patch).toEqual({ status: "paused" });
  });

  it("show prints schedule", async () => {
    const api = fakeApi();
    await handleRecurringShow(api, "s1", { json: false });
    expect(logs.join("")).toMatch(/Monthly/);
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteSchedule: async (id: string) => ({ dryRun: true, id, wouldDelete: { schedule: 1 } }) });
    await handleRecurringDelete(api, { id: "s1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("retainer show/update/delete handlers", () => {
  it("show prints retainer", async () => {
    const api = fakeApi();
    await handleRetainerShow(api, "r1", { json: false });
    expect(logs.join("")).toMatch(/Retainer/);
  });

  it("update passes status through", async () => {
    const api = fakeApi();
    await handleRetainerUpdate(api, { id: "r1", status: "ended", name: "Old block" }, { json: true });
    const [, id, patch] = api.calls.find(([m]: any) => m === "updateRetainer");
    expect(id).toBe("r1");
    expect(patch).toEqual({ name: "Old block", status: "ended" });
  });

  it("delete with --dry-run prints preview", async () => {
    const api = fakeApi({ deleteRetainer: async (id: string) => ({ dryRun: true, id, wouldDelete: { retainer: 1 } }) });
    await handleRetainerDelete(api, { id: "r1", dryRun: true }, { json: false });
    expect(logs.join("")).toMatch(/Dry run/);
  });
});

describe("settings show/set handlers", () => {
  it("show prints settings", async () => {
    const api = fakeApi({ getSettings: async () => ({ business: { name: "Acme Co" } }) });
    await handleSettingsShow(api, { json: false });
    expect(logs.join("")).toMatch(/Acme Co/);
  });

  it("set parses JSON and rejects non-objects", async () => {
    const api = fakeApi();
    await handleSettingsSet(api, { patch: '{"invoice":{"paymentTermsDays":30}}' }, { json: true });
    const [, patch] = api.calls.find(([m]: any) => m === "updateSettings");
    expect(patch).toEqual({ invoice: { paymentTermsDays: 30 } });
    await expect(handleSettingsSet(api, { patch: "[1,2]" }, { json: true })).rejects.toThrow("JSON object");
  });
});

describe("report revenue handler", () => {
  it("aggregates paid invoices by client", async () => {
    const api = fakeApi({
      listInvoices: async () => [
        { id: "i1", clientId: "c1", total: 1000, status: "paid" },
        { id: "i2", clientId: "c1", total: 500.5, status: "paid" },
        { id: "i3", clientId: "c2", total: 250, status: "paid" },
      ],
      listClients: async () => [{ id: "c1", name: "Acme" }, { id: "c2", name: "Beta" }],
    });
    await handleReportRevenue(api, { month: "2026-09" }, { json: true });
    const out = JSON.parse(logs.join(""));
    expect(out.month).toBe("2026-09");
    expect(out.invoices).toBe(3);
    expect(out.revenue).toBe(1750.5);
    expect(out.byClient.find((r: any) => r.clientId === "c1").total).toBe(1500.5);
  });

  it("rejects bad month format", async () => {
    const api = fakeApi();
    await expect(handleReportRevenue(api, { month: "sept" }, { json: true })).rejects.toThrow('YYYY-MM');
  });
});

describe("bulk commands", () => {
  it("tasks bulk registers with --items flag", () => {
    const program = buildProgram();
    const tasks = program.commands.find((c: any) => c.name() === "tasks");
    const bulk = tasks!.commands.find((c: any) => c.name() === "bulk");
    expect(bulk).toBeTruthy();
    expect(bulk!.options.map((o: any) => o.long)).toContain("--items");
  });

  it("expense bulk registers with --items flag", () => {
    const program = buildProgram();
    const expense = program.commands.find((c: any) => c.name() === "expense");
    const bulk = expense!.commands.find((c: any) => c.name() === "bulk");
    expect(bulk).toBeTruthy();
    expect(bulk!.options.map((o: any) => o.long)).toContain("--items");
  });

  it("handleTasksBulk maps minutes/date/note onto task create items", async () => {
    const api = fakeApi({
      bulkCreateTasks: async (items: any[]) => items,
    });
    await handleTasksBulk(
      api,
      {
        items: JSON.stringify([
          { projectId: "p1", minutes: 90, date: "2026-09-20", note: "Review" },
          { projectId: "p2", minutes: 30, note: "Standup" },
        ]),
      },
      { json: false },
    );
    expect(logs.join(" ")).toMatch(/Created 2 task\(s\)/);
  });

  it("handleTasksBulk calls the API with derived startAt/endAt/durationMinutes", async () => {
    let received: any[] = [];
    const api = fakeApi({
      bulkCreateTasks: async (items: any[]) => {
        received = items;
        return items;
      },
    });
    await handleTasksBulk(
      api,
      { items: JSON.stringify([{ projectId: "p1", minutes: 60, date: "2026-09-20", note: "Deep work" }]) },
      { json: true },
    );
    expect(received).toHaveLength(1);
    const item = received[0];
    expect(item.projectId).toBe("p1");
    expect(item.name).toBe("Deep work");
    expect(item.durationMinutes).toBe(60);
    expect(item.endAt - item.startAt).toBe(3600000);
    expect(new Date(item.startAt).toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("handleTasksBulk rejects bad JSON, missing projectId, non-positive minutes", async () => {
    const api = fakeApi();
    await expect(handleTasksBulk(api, { items: "nope[" }, { json: true })).rejects.toThrow();
    await expect(
      handleTasksBulk(api, { items: JSON.stringify([{ minutes: 30 }]) }, { json: true }),
    ).rejects.toThrow("projectId");
    await expect(
      handleTasksBulk(api, { items: JSON.stringify([{ projectId: "p1", minutes: 0 }]) }, { json: true }),
    ).rejects.toThrow("minutes");
  });

  it("handleExpensesBulk maps amount/category/date onto expense create items", async () => {
    let received: any[] = [];
    const api = fakeApi({
      bulkCreateExpenses: async (items: any[]) => {
        received = items;
        return items;
      },
    });
    await handleExpensesBulk(
      api,
      {
        items: JSON.stringify([
          { amount: 42.5, category: "travel", date: "2026-09-20", client: "c1", note: "Train" },
        ]),
      },
      { json: false },
    );
    expect(received).toHaveLength(1);
    const item = received[0];
    expect(item.amount).toBe(42.5);
    expect(item.category).toBe("travel");
    expect(item.clientId).toBe("c1");
    expect(item.note).toBe("Train");
    expect(new Date(item.date).toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(logs.join(" ")).toMatch(/Created 1 expense\(s\)/);
  });

  it("handleExpensesBulk rejects bad amounts and missing categories", async () => {
    const api = fakeApi();
    await expect(
      handleExpensesBulk(api, { items: JSON.stringify([{ amount: -5, category: "x" }]) }, { json: true }),
    ).rejects.toThrow("positive amount");
    await expect(
      handleExpensesBulk(api, { items: JSON.stringify([{ amount: 5 }]) }, { json: true }),
    ).rejects.toThrow("category");
  });
});

describe("update handlers leave archived alone unless the flag is passed", () => {
  it("handleClientUpdate omits archived when the option is undefined", async () => {
    let patch: any = null;
    const api = fakeApi({
      updateClient: async (_id: string, p: any) => {
        patch = p;
        return { id: _id, name: "Acme", ...p };
      },
    });
    await handleClientUpdate(api, { id: "c1", name: "Acme" }, { json: true });
    expect(patch).toEqual({ name: "Acme" });
    expect("archived" in patch).toBe(false);
  });

  it("handleClientUpdate forwards explicit archived true/false", async () => {
    let patch: any = null;
    const api = fakeApi({
      updateClient: async (_id: string, p: any) => {
        patch = p;
        return { id: _id, name: "Acme", ...p };
      },
    });
    await handleClientUpdate(api, { id: "c1", archived: true }, { json: true });
    expect(patch).toEqual({ archived: true });
    await handleClientUpdate(api, { id: "c1", archived: false }, { json: true });
    expect(patch).toEqual({ archived: false });
  });

  it("handleProjectUpdate omits archived when the option is undefined", async () => {
    let patch: any = null;
    const api = fakeApi({
      updateProject: async (_id: string, p: any) => {
        patch = p;
        return { id: _id, name: "P", ...p };
      },
    });
    await handleProjectUpdate(api, { id: "p1", name: "P" }, { json: true });
    expect("archived" in patch).toBe(false);
    await handleProjectUpdate(api, { id: "p1", archived: false }, { json: true });
    expect(patch).toEqual({ archived: false });
  });
});
