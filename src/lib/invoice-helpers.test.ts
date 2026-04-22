import { describe, expect, it } from "vitest";
import {
  computeDueDate,
  computeLineAmount,
  expenseToLineItem,
  formatInvoiceNumber,
  inferClientIdFromSelection,
  invoiceTotals,
  makeManualLineItem,
  round2,
  sumLineItems,
  taskToLineItem,
} from "@/lib/invoice-helpers";
import type { Client, Expense, Project, Task } from "@/lib/db/types";

function task(partial: Partial<Task> & Pick<Task, "id" | "projectId">): Task {
  return {
    id: partial.id,
    projectId: partial.projectId,
    name: partial.name ?? "Work",
    startAt: partial.startAt ?? 0,
    endAt: partial.endAt ?? 0,
    durationMinutes: partial.durationMinutes ?? 60,
    tags: partial.tags ?? [],
    isBilled: partial.isBilled ?? false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(1.005)).toBe(1);
    expect(round2(1.009)).toBe(1.01);
    expect(round2(2 / 3)).toBe(0.67);
  });
});

describe("computeLineAmount", () => {
  it("multiplies and rounds", () => {
    expect(computeLineAmount(1.5, 100)).toBe(150);
    expect(computeLineAmount(0.333, 30)).toBe(9.99);
  });
});

describe("sumLineItems", () => {
  it("sums and rounds each item's amount", () => {
    expect(
      sumLineItems([
        { id: "a", description: "", quantity: 1, rate: 10, amount: 10 },
        { id: "b", description: "", quantity: 1, rate: 12.345, amount: 12.35 },
        { id: "c", description: "", quantity: 1, rate: 0, amount: 0 },
      ]),
    ).toBe(22.35);
  });
});

describe("computeDueDate", () => {
  it("adds N days in ms", () => {
    const iso = new Date("2026-04-22T00:00:00Z").getTime();
    expect(computeDueDate(iso, 14)).toBe(iso + 14 * 86_400_000);
  });
});

describe("formatInvoiceNumber", () => {
  it("concatenates prefix + number", () => {
    expect(formatInvoiceNumber("INV-", 1001)).toBe("INV-1001");
    expect(formatInvoiceNumber("", 5)).toBe("5");
  });
});

describe("taskToLineItem", () => {
  const client: Client = {
    id: "cli_a",
    name: "Acme",
    defaultRate: 100,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  };
  const project: Project = {
    id: "prj_a",
    clientId: "cli_a",
    name: "P1",
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  };

  it("uses project override over client default rate", () => {
    const withOverride: Project = { ...project, rateOverride: 150 };
    const t = task({
      id: "t1",
      projectId: "prj_a",
      durationMinutes: 90,
    });
    const li = taskToLineItem(t, withOverride, client);
    expect(li.quantity).toBe(1.5);
    expect(li.rate).toBe(150);
    expect(li.amount).toBe(225);
    expect(li.sourceType).toBe("task");
    expect(li.sourceId).toBe("t1");
  });

  it("falls back to client default when no override", () => {
    const t = task({
      id: "t2",
      projectId: "prj_a",
      durationMinutes: 60,
    });
    const li = taskToLineItem(t, project, client);
    expect(li.rate).toBe(100);
    expect(li.amount).toBe(100);
  });

  it("defaults to 0 rate when no client or project rate", () => {
    const noRate: Client = { ...client, defaultRate: undefined };
    const t = task({ id: "t3", projectId: "prj_a", durationMinutes: 30 });
    const li = taskToLineItem(t, project, noRate);
    expect(li.rate).toBe(0);
    expect(li.amount).toBe(0);
  });
});

describe("expenseToLineItem", () => {
  const base: Expense = {
    id: "exp_1",
    date: 0,
    amount: 42.5,
    category: "Software",
    isBilled: false,
    createdAt: 0,
    updatedAt: 0,
  };

  it("maps amount into rate and amount; qty=1", () => {
    const li = expenseToLineItem(base);
    expect(li.quantity).toBe(1);
    expect(li.rate).toBe(42.5);
    expect(li.amount).toBe(42.5);
    expect(li.sourceType).toBe("expense");
    expect(li.sourceId).toBe("exp_1");
  });

  it("appends note to description when present", () => {
    const li = expenseToLineItem({ ...base, note: "Figma sub" });
    expect(li.description).toBe("Software — Figma sub");
  });
});

describe("inferClientIdFromSelection", () => {
  const projects: Project[] = [
    {
      id: "prj_a",
      clientId: "cli_a",
      name: "P1",
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "prj_b",
      clientId: "cli_b",
      name: "P2",
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ];

  it("takes client from first task's project", () => {
    const tasks = [
      task({ id: "t1", projectId: "prj_a" }),
      task({ id: "t2", projectId: "prj_b" }),
    ];
    expect(inferClientIdFromSelection(tasks, [], projects)).toBe("cli_a");
  });

  it("falls through to expense clientId when tasks empty", () => {
    const expenses: Expense[] = [
      {
        id: "exp_1",
        date: 0,
        amount: 10,
        category: "X",
        clientId: "cli_b",
        isBilled: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    expect(inferClientIdFromSelection([], expenses, projects)).toBe("cli_b");
  });

  it("returns undefined when nothing resolves", () => {
    expect(inferClientIdFromSelection([], [], [])).toBeUndefined();
  });
});

describe("makeManualLineItem", () => {
  it("creates an empty manual line", () => {
    const li = makeManualLineItem();
    expect(li.description).toBe("");
    expect(li.quantity).toBe(1);
    expect(li.rate).toBe(0);
    expect(li.amount).toBe(0);
    expect(li.sourceType).toBe("manual");
  });
});

describe("invoiceTotals", () => {
  it("sets total equal to subtotal (no tax in MVP)", () => {
    const totals = invoiceTotals([
      { id: "a", description: "", quantity: 2, rate: 50, amount: 100 },
      { id: "b", description: "", quantity: 1, rate: 25, amount: 25 },
    ]);
    expect(totals.subtotal).toBe(125);
    expect(totals.total).toBe(125);
  });
});
