import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Invoice, type Settings } from "@/core/entities";
import type { StorageProvider } from "@/core/storage";
import { pluginRegistry, type Plugin } from "@/plugins";
import { runDunning } from "./dunning";

const DAY = 86_400_000;
const NOW = new Date("2026-09-26T12:00:00Z").getTime();

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    clientId: "client_1",
    invoiceNumber: "INV-001",
    issueDate: NOW - 40 * DAY,
    dueDate: NOW - 10 * DAY,
    status: "sent",
    lineItems: [],
    subtotal: 1000,
    total: 1000,
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 40 * DAY,
    ...overrides,
  };
}

interface FakeDb {
  invoices: Map<string, Invoice>;
  settings: Settings;
}

/** Minimal in-memory StorageProvider — only what runDunning touches. */
function makeProvider(db: FakeDb): StorageProvider {
  return {
    providerName: "fake",
    listInvoices: async () => Array.from(db.invoices.values()),
    getInvoice: async (id: string) => db.invoices.get(id),
    updateInvoice: async (id: string, patch: Partial<Invoice>) => {
      const current = db.invoices.get(id);
      if (current) db.invoices.set(id, { ...current, ...patch });
    },
    listClients: async () => [
      {
        id: "client_1",
        name: "Acme",
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    getSettings: async () => db.settings,
  } as unknown as StorageProvider;
}

function makeSettings(
  dunning: Partial<Settings["dunning"]> = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    dunning: { ...DEFAULT_SETTINGS.dunning, ...dunning },
  };
}

const seenOverdue: Invoice[] = [];
const capturePlugin: Plugin = {
  manifest: {
    name: "test-dunning-capture",
    version: "0.0.0",
    description: "test",
  },
  activate(ctx) {
    ctx.hooks.on("onInvoiceOverdue", (invoice) => {
      seenOverdue.push(invoice);
    });
  },
};

afterEach(() => {
  seenOverdue.length = 0;
  pluginRegistry.unregister("test-dunning-capture");
});

describe("runDunning", () => {
  it("short-circuits when dunning is disabled", async () => {
    const db: FakeDb = {
      invoices: new Map([["inv_1", makeInvoice()]]),
      settings: makeSettings({ enabled: false }),
    };
    const report = await runDunning(makeProvider(db), db.settings, { now: NOW });
    expect(report.enabled).toBe(false);
    expect(report.reminders).toHaveLength(0);
    expect(db.invoices.get("inv_1")?.reminderLog).toBeUndefined();
  });

  it("sends due reminders, persists the log, and emits onInvoiceOverdue", async () => {
    pluginRegistry.register(capturePlugin);
    const db: FakeDb = {
      // 10 days overdue → schedule [7, 14, 30] has day 7 due.
      invoices: new Map([["inv_1", makeInvoice()]]),
      settings: makeSettings(),
    };
    const report = await runDunning(makeProvider(db), db.settings, { now: NOW });
    expect(report.enabled).toBe(true);
    expect(report.overdueCount).toBe(1);
    expect(report.reminders).toHaveLength(1);
    expect(report.reminders[0]?.reminderDay).toBe(7);
    expect(report.newlyOverdue).toHaveLength(1);
    expect(seenOverdue).toHaveLength(1);
    expect(seenOverdue[0]?.id).toBe("inv_1");
    // Persisted.
    expect(db.invoices.get("inv_1")?.reminderLog).toEqual([
      { reminderDay: 7, sentAt: NOW },
    ]);
  });

  it("does not duplicate reminders or re-emit the hook on a second run", async () => {
    pluginRegistry.register(capturePlugin);
    const db: FakeDb = {
      invoices: new Map([
        [
          "inv_1",
          makeInvoice({ reminderLog: [{ reminderDay: 7, sentAt: NOW - DAY }] }),
        ],
      ]),
      settings: makeSettings(),
    };
    const report = await runDunning(makeProvider(db), db.settings, { now: NOW });
    expect(report.reminders).toHaveLength(0);
    expect(report.newlyOverdue).toHaveLength(0);
    expect(seenOverdue).toHaveLength(0);
    expect(db.invoices.get("inv_1")?.reminderLog).toHaveLength(1);
  });

  it("dry-run computes actions without persisting or emitting", async () => {
    pluginRegistry.register(capturePlugin);
    const db: FakeDb = {
      invoices: new Map([["inv_1", makeInvoice()]]),
      settings: makeSettings(),
    };
    const report = await runDunning(makeProvider(db), db.settings, {
      now: NOW,
      dryRun: true,
    });
    expect(report.dryRun).toBe(true);
    expect(report.reminders).toHaveLength(1);
    expect(db.invoices.get("inv_1")?.reminderLog).toBeUndefined();
    expect(seenOverdue).toHaveLength(0);
  });

  it("applies late fees past the grace period", async () => {
    const db: FakeDb = {
      // 45 days overdue; fee: 1.5%/mo after 30-day grace.
      invoices: new Map([
        ["inv_1", makeInvoice({ dueDate: NOW - 45 * DAY })],
      ]),
      settings: makeSettings({
        lateFee: {
          enabled: true,
          type: "percent",
          amount: 1.5,
          graceDays: 30,
          recurring: "monthly",
        },
      }),
    };
    const report = await runDunning(makeProvider(db), db.settings, { now: NOW });
    expect(report.lateFees).toHaveLength(1);
    expect(report.lateFees[0]?.amount).toBeGreaterThan(0);
    const updated = db.invoices.get("inv_1");
    expect(updated?.lateFeeApplications).toHaveLength(1);
    expect(updated?.total).toBeGreaterThan(1000);
    // Fee shows up as a line item.
    expect(
      updated?.lineItems.some((li) => li.description.includes("Late fee")),
    ).toBe(true);
  });

  it("ignores draft and paid invoices", async () => {
    const db: FakeDb = {
      invoices: new Map([
        ["inv_draft", makeInvoice({ id: "inv_draft", status: "draft" })],
        ["inv_paid", makeInvoice({ id: "inv_paid", status: "paid" })],
      ]),
      settings: makeSettings(),
    };
    const report = await runDunning(makeProvider(db), db.settings, { now: NOW });
    expect(report.invoicesChecked).toBe(0);
    expect(report.overdueCount).toBe(0);
  });

  it("scopes to invoiceIds when provided", async () => {
    const db: FakeDb = {
      invoices: new Map([
        ["inv_1", makeInvoice({ id: "inv_1" })],
        ["inv_2", makeInvoice({ id: "inv_2", invoiceNumber: "INV-002" })],
      ]),
      settings: makeSettings(),
    };
    const report = await runDunning(makeProvider(db), db.settings, {
      now: NOW,
      invoiceIds: ["inv_2"],
    });
    expect(report.invoicesChecked).toBe(1);
    expect(report.reminders[0]?.invoiceId).toBe("inv_2");
  });
});
