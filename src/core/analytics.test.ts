import { describe, expect, it } from "vitest";
import {
  clientProfitability,
  collectionRate,
  effectiveHourlyRate,
  isCompleteTask,
  monthlyTargetBurnUp,
  monthKey,
  outstandingReceivables,
  revenueByMonth,
  taskMinutes,
  totalBillableMinutes,
  utilizationPercent,
} from "./analytics";
import type {
  Client,
  Expense,
  Invoice,
  Project,
  Task,
} from "./entities";
import type { MileageEntry } from "./mileage";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0); // Sep 26 2026

function task(overrides: Partial<Task> = {}): Task {
  const startAt = Date.UTC(2026, 8, 10, 14, 0, 0);
  return {
    id: "tsk_1",
    projectId: "prj_1",
    name: "Work",
    startAt,
    endAt: startAt + 120 * 60_000,
    durationMinutes: 120,
    tags: [],
    isBilled: false,
    createdAt: startAt,
    updatedAt: startAt,
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  const issueDate = Date.UTC(2026, 8, 1);
  return {
    id: "inv_1",
    clientId: "cli_1",
    invoiceNumber: "INV-1001",
    issueDate,
    dueDate: issueDate + 14 * 86_400_000,
    status: "paid",
    lineItems: [],
    subtotal: 1000,
    total: 1000,
    createdAt: issueDate,
    updatedAt: issueDate,
    ...overrides,
  };
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: "cli_1",
    name: "Acme",
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("taskMinutes / isCompleteTask", () => {
  it("skips open timers (endAt 0)", () => {
    expect(isCompleteTask(task({ endAt: 0 }))).toBe(false);
    expect(taskMinutes(task({ endAt: 0 }))).toBe(0);
    expect(isCompleteTask(task())).toBe(true);
  });

  it("falls back to start/end diff when durationMinutes is missing", () => {
    const t = task({ durationMinutes: undefined as never });
    expect(taskMinutes(t)).toBe(120);
  });

  it("sums billable minutes", () => {
    expect(totalBillableMinutes([task(), task({ durationMinutes: 60 })])).toBe(
      180,
    );
  });
});

describe("effectiveHourlyRate / utilizationPercent", () => {
  it("divides revenue by billable hours", () => {
    expect(effectiveHourlyRate(1000, 120)).toBe(500);
  });

  it("returns null with no hours / no target", () => {
    expect(effectiveHourlyRate(1000, 0)).toBeNull();
    expect(utilizationPercent(100, 0)).toBeNull();
  });

  it("computes utilization", () => {
    expect(utilizationPercent(2400, 4800)).toBe(50);
  });
});

describe("revenueByMonth", () => {
  it("buckets sent+paid by issue month, skipping drafts", () => {
    const invoices = [
      invoice({ total: 1000 }), // paid, Sep
      invoice({
        id: "inv_2",
        status: "sent",
        total: 500,
        issueDate: Date.UTC(2026, 7, 15),
      }), // Aug
      invoice({
        id: "inv_3",
        status: "draft",
        total: 999,
        issueDate: Date.UTC(2026, 8, 5),
      }),
    ];
    const buckets = revenueByMonth(invoices, 2, NOW);
    expect(buckets.map((b) => b.month)).toEqual(["2026-08", "2026-09"]);
    const sep = buckets[1];
    expect(sep.invoiced).toBe(1000);
    expect(sep.collected).toBe(1000);
    expect(buckets[0].invoiced).toBe(500);
    expect(buckets[0].collected).toBe(0);
  });

  it("monthKey formats UTC months", () => {
    expect(monthKey(Date.UTC(2026, 0, 31, 23, 59))).toBe("2026-01");
  });
});

describe("clientProfitability", () => {
  it("computes revenue, costs, hours and profit per client", () => {
    const clients = [client(), client({ id: "cli_2", name: "Beta" })];
    const projects = new Map<string, Project>([
      ["prj_1", { id: "prj_1", clientId: "cli_1", name: "P", archived: false, createdAt: NOW, updatedAt: NOW }],
    ]);
    const invoices = [invoice({ total: 2000 })];
    const tasks = [task(), task({ id: "tsk_2", durationMinutes: 60 })];
    const expenses: Expense[] = [
      {
        id: "exp_1",
        clientId: "cli_1",
        date: NOW,
        amount: 100,
        category: "Travel",
        isBilled: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const mileage: MileageEntry[] = [
      {
        id: "mil_1",
        date: NOW,
        miles: 100,
        rate: 0.7,
        purpose: "Site visit",
        clientId: "cli_1",
        isBilled: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const rows = clientProfitability(
      clients,
      invoices,
      tasks,
      projects,
      expenses,
      mileage,
    );
    const acme = rows.find((r) => r.clientId === "cli_1")!;
    expect(acme.revenue).toBe(2000);
    expect(acme.expenses).toBe(100);
    expect(acme.mileageDeduction).toBe(70);
    expect(acme.hours).toBe(3);
    expect(acme.effectiveRate).toBeCloseTo(666.67, 2);
    expect(acme.profit).toBe(1830);
    const beta = rows.find((r) => r.clientId === "cli_2")!;
    expect(beta.revenue).toBe(0);
    expect(beta.effectiveRate).toBeNull();
    // Sorted by profit desc.
    expect(rows[0].clientId).toBe("cli_1");
  });

  it("excludes archived clients", () => {
    const rows = clientProfitability(
      [client({ archived: true })],
      [],
      [],
      new Map(),
      [],
      [],
    );
    expect(rows).toEqual([]);
  });
});

describe("outstandingReceivables", () => {
  it("splits outstanding vs overdue", () => {
    const invoices = [
      invoice({ id: "a", status: "sent", total: 300, dueDate: NOW - 86_400_000 }),
      invoice({ id: "b", status: "sent", total: 200, dueDate: NOW + 86_400_000 }),
      invoice({ id: "c", status: "paid", total: 500 }),
    ];
    const r = outstandingReceivables(invoices, NOW);
    expect(r).toEqual({
      outstanding: 500,
      outstandingCount: 2,
      overdue: 300,
      overdueCount: 1,
    });
  });
});

describe("monthlyTargetBurnUp", () => {
  it("accumulates collected vs target", () => {
    const monthly = [
      { month: "2026-08", invoiced: 1000, collected: 800 },
      { month: "2026-09", invoiced: 1200, collected: 1200 },
    ];
    const burn = monthlyTargetBurnUp(monthly, 1000);
    expect(burn).toEqual([
      { month: "2026-08", cumulative: 800, target: 1000 },
      { month: "2026-09", cumulative: 2000, target: 2000 },
    ]);
  });
});

describe("collectionRate", () => {
  it("returns collected/invoiced percent", () => {
    const invoices = [
      invoice({ total: 1000 }),
      invoice({ id: "b", status: "sent", total: 1000 }),
    ];
    expect(collectionRate(invoices)).toBe(50);
  });

  it("returns null with nothing invoiced", () => {
    expect(collectionRate([])).toBeNull();
    expect(collectionRate([invoice({ status: "draft" })])).toBeNull();
  });
});
