import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/core/entities";
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
} from "@/core/recurring";
import type { StorageProvider } from "@/core/storage";
import { getStorageProvider, setStorageProvider } from "@/lib/db/repos";
import { computeNextRun } from "@/core/recurring";
import { runDueRecurringSchedules } from "./recurring-scheduler";

const DAY = 86_400_000;

interface FakeState {
  clients: Map<ID, Client>;
  projects: Map<ID, Project>;
  tasks: Map<ID, Task>;
  expenses: Map<ID, Expense>;
  invoices: Map<ID, Invoice>;
  schedules: Map<ID, RecurringSchedule>;
  settings: Settings;
  nextInvoiceNumber: number;
  failInvoiceCreateForClients: Set<ID>;
}

/**
 * Minimal in-memory StorageProvider covering exactly what the recurring
 * scheduler touches. Anything else throws — loudly, so a test that strays
 * outside the scheduler's footprint fails instead of silently passing.
 */
function createFakeProvider(): { provider: StorageProvider; state: FakeState } {
  const state: FakeState = {
    clients: new Map(),
    projects: new Map(),
    tasks: new Map(),
    expenses: new Map(),
    invoices: new Map(),
    schedules: new Map(),
    settings: {
      ...DEFAULT_SETTINGS,
      invoice: { ...DEFAULT_SETTINGS.invoice, paymentTermsDays: 14 },
    },
    nextInvoiceNumber: 1,
    failInvoiceCreateForClients: new Set(),
  };

  const partial = {
    providerName: "fake-recurring",

    async listRecurringSchedules(status?: string) {
      const all = Array.from(state.schedules.values());
      return status ? all.filter((s) => s.status === status) : all;
    },
    async getRecurringSchedule(id: ID) {
      return state.schedules.get(id);
    },
    async createRecurringSchedule(input: RecurringScheduleCreateInput) {
      const ts = Date.now();
      const s = {
        id: `rsd_${state.schedules.size + 1}`,
        status: "active",
        nextRunAt: input.startDate,
        occurrences: 0,
        createdAt: ts,
        updatedAt: ts,
        ...input,
      } as RecurringSchedule;
      state.schedules.set(s.id, s);
      return s;
    },
    async updateRecurringSchedule(id: ID, patch: Partial<RecurringSchedule>) {
      const s = state.schedules.get(id);
      if (!s) throw new Error(`schedule not found: ${id}`);
      state.schedules.set(id, { ...s, ...patch, updatedAt: Date.now() });
    },

    async listUnbilledTasks() {
      return Array.from(state.tasks.values()).filter((t) => !t.isBilled);
    },
    async getTask(id: ID) {
      return state.tasks.get(id);
    },
    async updateTask(id: ID, patch: Partial<Task>) {
      const t = state.tasks.get(id);
      if (!t) throw new Error(`task not found: ${id}`);
      state.tasks.set(id, { ...t, ...patch, updatedAt: Date.now() });
    },

    async listExpenses() {
      return Array.from(state.expenses.values());
    },
    async updateExpense(id: ID, patch: Partial<Expense>) {
      const e = state.expenses.get(id);
      if (!e) throw new Error(`expense not found: ${id}`);
      state.expenses.set(id, { ...e, ...patch, updatedAt: Date.now() });
    },

    async listProjects() {
      return Array.from(state.projects.values());
    },
    async listClients() {
      return Array.from(state.clients.values());
    },

    async createInvoice(input: Partial<Invoice> & { clientId: ID }) {
      if (state.failInvoiceCreateForClients.has(input.clientId)) {
        throw new Error("boom: invoice storage failed");
      }
      const ts = Date.now();
      const inv = {
        id: `inv_${state.invoices.size + 1}`,
        createdAt: ts,
        updatedAt: ts,
        ...input,
      } as Invoice;
      state.invoices.set(inv.id, inv);
      return inv;
    },
    async assignNextInvoiceNumber() {
      return `INV-${state.nextInvoiceNumber++}`;
    },
    async getSettings() {
      return state.settings;
    },
  };

  const provider = new Proxy(partial, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return async () => {
        throw new Error(
          `fake StorageProvider: ${String(prop)} not implemented`,
        );
      };
    },
  }) as unknown as StorageProvider;

  return { provider, state };
}

function seedClient(state: FakeState, name: string, defaultRate = 100): Client {
  const c: Client = {
    id: `cli_${name}`,
    name,
    defaultRate,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  };
  state.clients.set(c.id, c);
  return c;
}

function seedProject(state: FakeState, client: Client, name: string): Project {
  const p: Project = {
    id: `prj_${name}`,
    clientId: client.id,
    name,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  };
  state.projects.set(p.id, p);
  return p;
}

function seedTask(
  state: FakeState,
  project: Project,
  minutes: number,
  isBilled = false,
): Task {
  const startAt = Date.UTC(2026, 2, 10, 14, 0, 0);
  const t: Task = {
    id: `tsk_${state.tasks.size + 1}`,
    projectId: project.id,
    name: "Work",
    startAt,
    endAt: startAt + minutes * 60_000,
    durationMinutes: minutes,
    tags: [],
    isBilled,
    createdAt: 0,
    updatedAt: 0,
  };
  state.tasks.set(t.id, t);
  return t;
}

function seedExpense(
  state: FakeState,
  client: Client,
  amount: number,
  isBilled = false,
): Expense {
  const e: Expense = {
    id: `exp_${state.expenses.size + 1}`,
    clientId: client.id,
    date: Date.UTC(2026, 2, 11),
    amount,
    category: "Travel",
    isBilled,
    createdAt: 0,
    updatedAt: 0,
  };
  state.expenses.set(e.id, e);
  return e;
}

function seedSchedule(
  state: FakeState,
  overrides: Partial<RecurringSchedule> & { clientId: ID },
): RecurringSchedule {
  const start = Date.UTC(2026, 0, 15);
  const s: RecurringSchedule = {
    id: `rsd_${state.schedules.size + 1}`,
    name: "Sched",
    mode: "fixed",
    frequency: "monthly",
    interval: 1,
    lineItems: [],
    startDate: start,
    nextRunAt: start,
    occurrences: 0,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
  state.schedules.set(s.id, s);
  return s;
}

describe("runDueRecurringSchedules", () => {
  let fake: { provider: StorageProvider; state: FakeState };
  let original: StorageProvider;

  beforeEach(() => {
    original = getStorageProvider();
    fake = createFakeProvider();
    setStorageProvider(fake.provider);
  });

  afterEach(() => {
    setStorageProvider(original);
  });

  it("fixed mode generates a draft invoice and advances the schedule", async () => {
    const client = seedClient(fake.state, "Acme");
    const nextRunAt = Date.UTC(2026, 0, 15);
    const s = seedSchedule(fake.state, {
      clientId: client.id,
      name: "Acme retainer",
      nextRunAt,
      lineItems: [
        { description: "Monthly retainer", quantity: 1, rate: 500 },
        { description: "Hosting", quantity: 2, rate: 25 },
      ],
    });

    const now = nextRunAt + DAY;
    const { generated, skipped } = await runDueRecurringSchedules(now);

    expect(skipped).toHaveLength(0);
    expect(generated).toHaveLength(1);
    const inv = generated[0];
    expect(inv.status).toBe("draft");
    expect(inv.clientId).toBe(client.id);
    expect(inv.invoiceNumber).toBe("INV-1");
    expect(inv.lineItems).toHaveLength(2);
    expect(inv.lineItems[0].amount).toBe(500);
    expect(inv.lineItems[1].amount).toBe(50);
    expect(inv.subtotal).toBe(550);
    expect(inv.total).toBe(550);
    expect(inv.issueDate).toBe(now);
    expect(inv.dueDate).toBe(now + 14 * DAY);
    expect(inv.notes).toContain("Acme retainer");

    const updated = fake.state.schedules.get(s.id)!;
    expect(updated.occurrences).toBe(1);
    expect(updated.lastRunAt).toBe(now);
    expect(updated.nextRunAt).toBe(computeNextRun(nextRunAt, "monthly", 1));
    expect(updated.status).toBe("active");
  });

  it("skips schedules that are not due yet", async () => {
    const client = seedClient(fake.state, "Acme");
    seedSchedule(fake.state, {
      clientId: client.id,
      nextRunAt: Date.UTC(2026, 5, 1),
      lineItems: [{ description: "X", quantity: 1, rate: 10 }],
    });
    const { generated, skipped } = await runDueRecurringSchedules(
      Date.UTC(2026, 0, 20),
    );
    expect(generated).toHaveLength(0);
    expect(skipped).toHaveLength(0);
    expect(fake.state.invoices.size).toBe(0);
  });

  it("unbilled mode collects scoped work, claims it, and skips when empty", async () => {
    const acme = seedClient(fake.state, "Acme", 100);
    const other = seedClient(fake.state, "Other", 200);
    const p1 = seedProject(fake.state, acme, "Site");
    const p2 = seedProject(fake.state, other, "App");
    const t1 = seedTask(fake.state, p1, 120); // 2h × $100
    const t2 = seedTask(fake.state, p2, 60); // other client — excluded
    const e1 = seedExpense(fake.state, acme, 45);
    const e2 = seedExpense(fake.state, acme, 99, true); // already billed — excluded

    const s = seedSchedule(fake.state, {
      clientId: acme.id,
      mode: "unbilled",
      nextRunAt: Date.UTC(2026, 0, 15),
    });

    const { generated } = await runDueRecurringSchedules(
      Date.UTC(2026, 0, 16),
    );
    expect(generated).toHaveLength(1);
    const inv = generated[0];
    expect(inv.lineItems).toHaveLength(2);
    const taskLine = inv.lineItems.find((l) => l.sourceType === "task")!;
    expect(taskLine.quantity).toBe(2);
    expect(taskLine.rate).toBe(100);
    expect(taskLine.amount).toBe(200);
    const expLine = inv.lineItems.find((l) => l.sourceType === "expense")!;
    expect(expLine.amount).toBe(45);
    expect(inv.total).toBe(245);

    // Source work claimed; everything else untouched.
    expect(fake.state.tasks.get(t1.id)!.isBilled).toBe(true);
    expect(fake.state.tasks.get(t1.id)!.invoiceId).toBe(inv.id);
    expect(fake.state.expenses.get(e1.id)!.isBilled).toBe(true);
    expect(fake.state.tasks.get(t2.id)!.isBilled).toBe(false);
    expect(fake.state.expenses.get(e2.id)!.invoiceId).toBeUndefined();

    // Second run: nothing left unbilled → skipped, schedule not advanced.
    const again = await runDueRecurringSchedules(Date.UTC(2026, 1, 20));
    expect(again.generated).toHaveLength(0);
    expect(again.skipped).toHaveLength(1);
    expect(again.skipped[0].reason).toMatch(/nothing unbilled/);
    expect(fake.state.schedules.get(s.id)!.occurrences).toBe(1);
  });

  it("project-scoped unbilled schedules only bill that project", async () => {
    const acme = seedClient(fake.state, "Acme", 100);
    const p1 = seedProject(fake.state, acme, "Site");
    const p2 = seedProject(fake.state, acme, "Blog");
    seedTask(fake.state, p1, 60);
    seedTask(fake.state, p2, 60);
    seedSchedule(fake.state, {
      clientId: acme.id,
      projectId: p1.id,
      mode: "unbilled",
      nextRunAt: Date.UTC(2026, 0, 15),
    });
    const { generated } = await runDueRecurringSchedules(Date.UTC(2026, 0, 16));
    expect(generated).toHaveLength(1);
    expect(generated[0].lineItems).toHaveLength(1);
  });

  it("ends the schedule when maxOccurrences is reached", async () => {
    const client = seedClient(fake.state, "Acme");
    const s = seedSchedule(fake.state, {
      clientId: client.id,
      maxOccurrences: 1,
      nextRunAt: Date.UTC(2026, 0, 15),
      lineItems: [{ description: "One-off", quantity: 1, rate: 10 }],
    });
    const { generated } = await runDueRecurringSchedules(Date.UTC(2026, 0, 16));
    expect(generated).toHaveLength(1);
    expect(fake.state.schedules.get(s.id)!.status).toBe("ended");
  });

  it("a failing schedule does not abort the run", async () => {
    const a = seedClient(fake.state, "Acme");
    const b = seedClient(fake.state, "Broken");
    fake.state.failInvoiceCreateForClients.add(b.id);
    seedSchedule(fake.state, {
      clientId: a.id,
      name: "Good",
      nextRunAt: Date.UTC(2026, 0, 15),
      lineItems: [{ description: "X", quantity: 1, rate: 10 }],
    });
    seedSchedule(fake.state, {
      clientId: b.id,
      name: "Bad",
      nextRunAt: Date.UTC(2026, 0, 15),
      lineItems: [{ description: "X", quantity: 1, rate: 10 }],
    });
    const { generated, skipped } = await runDueRecurringSchedules(
      Date.UTC(2026, 0, 16),
    );
    expect(generated).toHaveLength(1);
    expect(generated[0].clientId).toBe(a.id);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].scheduleName).toBe("Bad");
    expect(skipped[0].reason).toMatch(/boom/);
  });

  it("run-now fires a paused schedule and keeps it paused", async () => {
    const client = seedClient(fake.state, "Acme");
    const s = seedSchedule(fake.state, {
      clientId: client.id,
      status: "paused",
      nextRunAt: Date.UTC(2026, 5, 1), // not due
      lineItems: [{ description: "X", quantity: 1, rate: 10 }],
    });
    const { generated } = await runDueRecurringSchedules(
      Date.UTC(2026, 0, 16),
      s.id,
    );
    expect(generated).toHaveLength(1);
    const updated = fake.state.schedules.get(s.id)!;
    expect(updated.occurrences).toBe(1);
    expect(updated.status).toBe("paused");
  });

  it("run-now refuses an ended schedule", async () => {
    const client = seedClient(fake.state, "Acme");
    const s = seedSchedule(fake.state, {
      clientId: client.id,
      status: "ended",
      nextRunAt: Date.UTC(2026, 0, 15),
      lineItems: [{ description: "X", quantity: 1, rate: 10 }],
    });
    const { generated, skipped } = await runDueRecurringSchedules(
      Date.UTC(2026, 0, 16),
      s.id,
    );
    expect(generated).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/ended/);
  });
});
