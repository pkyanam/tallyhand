import { describe, expect, it } from "vitest";
import {
  applyLateFeeToInvoice,
  computeDunningActions,
  computeLateFeeAmount,
  daysBetween,
  DEFAULT_DUNNING_CONFIG,
  isOverdue,
  renderReminder,
  MS_PER_DAY,
  type DunningConfig,
} from "./dunning";
import type { Invoice } from "./entities";

const DAY = MS_PER_DAY;
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0); // Sep 26 2026

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  const issueDate = NOW - 60 * DAY;
  return {
    id: "inv_1",
    clientId: "cli_1",
    invoiceNumber: "INV-1001",
    issueDate,
    dueDate: issueDate + 30 * DAY, // due 30 days ago
    status: "sent",
    lineItems: [],
    subtotal: 1000,
    total: 1000,
    createdAt: issueDate,
    updatedAt: issueDate,
    ...overrides,
  };
}

function config(overrides: Partial<DunningConfig> = {}): DunningConfig {
  return {
    ...DEFAULT_DUNNING_CONFIG,
    lateFee: { ...DEFAULT_DUNNING_CONFIG.lateFee, ...overrides.lateFee },
    ...overrides,
  };
}

const clients = new Map([["cli_1", { id: "cli_1", name: "Acme Corp" }]]);

describe("daysBetween / isOverdue", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysBetween(NOW, NOW + 12 * 3_600_000)).toBe(0);
    expect(daysBetween(NOW - 36 * 3_600_000, NOW)).toBe(1);
    expect(daysBetween(NOW, NOW - DAY)).toBe(0);
  });

  it("only flags sent invoices past their due date", () => {
    expect(isOverdue(invoice(), NOW)).toBe(true);
    expect(isOverdue(invoice({ status: "draft" }), NOW)).toBe(false);
    expect(
      isOverdue(invoice({ status: "sent", dueDate: NOW + DAY }), NOW),
    ).toBe(false);
    expect(isOverdue(invoice({ status: "paid" }), NOW)).toBe(false);
  });
});

describe("computeDunningActions reminders", () => {
  it("emits reminders for every crossed schedule day without history", () => {
    // 30 days overdue, schedule [7, 14, 30] → all three stages fire.
    const actions = computeDunningActions([invoice()], clients, config(), NOW);
    expect(actions.reminders.map((r) => r.reminderDay)).toEqual([7, 14, 30]);
    expect(actions.reminders.map((r) => r.stage)).toEqual([0, 1, 2]);
    expect(actions.newlyOverdue.map((i) => i.id)).toEqual(["inv_1"]);
  });

  it("skips schedule days already recorded in reminderLog", () => {
    const inv = invoice({
      reminderLog: [{ reminderDay: 7, sentAt: NOW - 20 * DAY }],
    });
    const actions = computeDunningActions([inv], clients, config(), NOW);
    expect(actions.reminders.map((r) => r.reminderDay)).toEqual([14, 30]);
    // Reminder history exists → not "newly" overdue.
    expect(actions.newlyOverdue).toEqual([]);
  });

  it("ignores non-overdue and disabled configs", () => {
    const notDue = invoice({ dueDate: NOW + DAY });
    expect(
      computeDunningActions([notDue], clients, config(), NOW).reminders,
    ).toEqual([]);
    expect(
      computeDunningActions([invoice()], clients, config({ enabled: false }), NOW)
        .reminders,
    ).toEqual([]);
  });

  it("escalates tone across stages when enabled", () => {
    const actions = computeDunningActions([invoice()], clients, config(), NOW);
    const subjects = actions.reminders.map((r) => r.subject);
    expect(subjects[0]).toContain("Friendly reminder");
    expect(subjects[2]).toContain("Final notice");
  });

  it("uses the friendly tone for every stage when escalation is off", () => {
    const actions = computeDunningActions(
      [invoice()],
      clients,
      config({ escalatingTone: false }),
      NOW,
    );
    for (const r of actions.reminders) {
      expect(r.subject).toContain("Friendly reminder");
    }
  });
});

describe("renderReminder", () => {
  it("clamps the stage to the last tone template", () => {
    const { subject } = renderReminder({
      clientName: "Acme",
      invoiceNumber: "INV-1",
      amountDue: 100,
      daysOverdue: 90,
      stage: 99,
      escalatingTone: true,
    });
    expect(subject).toContain("Final notice");
  });
});

describe("computeLateFeeAmount", () => {
  const feeCfg = (overrides = {}) =>
    config({
      lateFee: {
        enabled: true,
        type: "percent",
        amount: 1.5,
        graceDays: 30,
        recurring: "once",
        ...overrides,
      },
    });

  it("returns 0 before the grace period elapses", () => {
    const inv = invoice({ dueDate: NOW - 10 * DAY });
    expect(computeLateFeeAmount(inv, feeCfg().lateFee, NOW)).toBe(0);
  });

  it("computes a percent fee of the invoice total", () => {
    // 30 days overdue meets the 30-day grace threshold.
    expect(computeLateFeeAmount(invoice(), feeCfg().lateFee, NOW)).toBe(15);
  });

  it("computes a flat fee", () => {
    const c = feeCfg({ type: "flat", amount: 25 });
    expect(computeLateFeeAmount(invoice(), c.lateFee, NOW)).toBe(25);
  });

  it("applies only once when recurring is 'once'", () => {
    const inv = invoice({
      lateFeeApplications: [{ appliedAt: NOW - 5 * DAY, amount: 15 }],
    });
    expect(computeLateFeeAmount(inv, feeCfg().lateFee, NOW)).toBe(0);
  });

  it("re-applies every 30 days when recurring is 'monthly'", () => {
    const c = feeCfg({ recurring: "monthly" });
    const inv = invoice({
      dueDate: NOW - 75 * DAY,
      lateFeeApplications: [{ appliedAt: NOW - 40 * DAY, amount: 15 }],
    });
    // 75 days overdue, grace 30 → windows at 30 and 60 days; one applied.
    expect(computeLateFeeAmount(inv, c.lateFee, NOW)).toBe(15);
    const inv2 = invoice({
      dueDate: NOW - 75 * DAY,
      lateFeeApplications: [
        { appliedAt: NOW - 40 * DAY, amount: 15 },
        { appliedAt: NOW - 10 * DAY, amount: 15 },
      ],
    });
    expect(computeLateFeeAmount(inv2, c.lateFee, NOW)).toBe(0);
  });

  it("respects the maxTotal cap", () => {
    const c = feeCfg({ type: "flat", amount: 25, maxTotal: 30 });
    // 65 days overdue, grace 30, monthly → windows at 30 and 60 days open.
    const inv = invoice({
      dueDate: NOW - 65 * DAY,
      lateFeeApplications: [{ appliedAt: NOW - 5 * DAY, amount: 20 }],
    });
    const cm = feeCfg({
      type: "flat",
      amount: 25,
      maxTotal: 30,
      recurring: "monthly",
    });
    expect(computeLateFeeAmount(inv, cm.lateFee, NOW)).toBe(10);
    expect(computeLateFeeAmount(invoice(), c.lateFee, NOW)).toBe(25);
  });

  it("is disabled by default", () => {
    expect(
      computeLateFeeAmount(
        invoice(),
        DEFAULT_DUNNING_CONFIG.lateFee,
        NOW,
      ),
    ).toBe(0);
  });
});

describe("applyLateFeeToInvoice", () => {
  it("appends a line item and bumps totals", () => {
    const inv = invoice();
    const next = applyLateFeeToInvoice(
      inv,
      { invoiceId: inv.id, amount: 15, description: "Late fee (1.5%, 30 days overdue)" },
      NOW,
    );
    expect(next.total).toBe(1015);
    expect(next.subtotal).toBe(1015);
    expect(next.lineItems).toHaveLength(1);
    expect(next.lineItems[0].sourceType).toBe("manual");
    expect(next.lineItems[0].amount).toBe(15);
    expect(next.lateFeeApplications).toHaveLength(1);
    expect(next.lateFeeApplications?.[0].amount).toBe(15);
    // Original untouched (pure).
    expect(inv.total).toBe(1000);
  });
});

describe("computeDunningActions late fees", () => {
  it("includes a late fee when the policy is enabled and grace has passed", () => {
    const c = config({
      lateFee: {
        enabled: true,
        type: "flat",
        amount: 25,
        graceDays: 14,
        recurring: "once",
      },
    });
    const actions = computeDunningActions([invoice()], clients, c, NOW);
    expect(actions.lateFees).toHaveLength(1);
    expect(actions.lateFees[0].amount).toBe(25);
  });
});
