import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProgram } from "../src/cli.js";
import {
  handleTimerStart,
  handleTimerStop,
  handleTimerStatus,
  handleLog,
  handleInvoiceDraft,
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
    listInvoices: async () => [],
    createInvoice: async (i: any) => {
      calls.push(["createInvoice", i]);
      return { id: "inv1", invoiceNumber: "INV-1001", ...i };
    },
    getInvoice: async (id: string) => ({ id }),
    sendInvoice: async (id: string) => ({ id, status: "sent" }),
    markInvoicePaid: async (id: string) => ({ id, status: "paid" }),
    listSchedules: async () => [],
    createSchedule: async (i: any) => ({ id: "s1", ...i }),
    runSchedule: async (id: string) => ({ ran: id }),
    runScheduler: async () => ({ ran: 0 }),
    listRetainers: async () => [],
    createRetainer: async (i: any) => ({ id: "r1", ...i }),
    getSettings: async () => ({}),
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
    find(["invoice", "list"]);
    find(["invoice", "show"]);
    find(["invoice", "send"]);
    find(["invoice", "paid"]);
  });

  it("recurring / retainer / expense / export / config / doctor / mcp", () => {
    find(["recurring", "list"]);
    find(["recurring", "create"]);
    find(["recurring", "run"]);
    find(["retainer", "list"]);
    find(["retainer", "create"]);
    find(["expense", "add"]);
    find(["export"]);
    find(["config", "set"]);
    find(["config", "show"]);
    find(["doctor"]);
    find(["mcp"]);
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
    await handleTimerStart(api, { project: "p1", note: "Design", tags: "a,b" }, { json: true });
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
    await handleLog(
      api,
      { project: "p1", minutes: 90, date: "2026-09-20", note: "Review" },
      { json: true },
    );
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
