/**
 * v1 → v2 bundle import tests: detection, field migration, zod validation.
 *
 * Builds legacy-shaped `tallyhand.v1` payloads (the way older exports
 * actually looked — optional arrays/sections absent, defaults missing) and
 * asserts they migrate into clean, validated bundles. Also asserts that
 * corrupt payloads and non-bundle files are rejected with clear errors.
 */
import { describe, expect, it } from "vitest";
import {
  detectBundleFormat,
  parseAndValidateBundle,
} from "@/lib/v1-import";

/** A minimal but valid tallyhand.v1 bundle. */
function validBundle() {
  return {
    format: "tallyhand.v1",
    exportedAt: new Date().toISOString(),
    settings: { id: "singleton", business: { name: "Acme" } },
    clients: [
      {
        id: "cli_1",
        name: "Acme",
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    projects: [],
    tasks: [],
    expenses: [],
    invoices: [],
    recurringSchedules: [],
    retainers: [],
    mileageEntries: [],
    contracts: [],
    taxPayments: [],
    rateCards: [],
  };
}

describe("detectBundleFormat", () => {
  it("recognizes tallyhand.v1 bundles", () => {
    expect(detectBundleFormat(validBundle())).toBe("tallyhand.v1");
  });
  it("recognizes ledger exports so we can reject them helpfully", () => {
    expect(detectBundleFormat({ format: "tallyhand.ledger.v1", rows: [] })).toBe(
      "tallyhand.ledger.v1",
    );
  });
  it("returns unknown for garbage", () => {
    expect(detectBundleFormat(null)).toBe("unknown");
    expect(detectBundleFormat("nope")).toBe("unknown");
    expect(detectBundleFormat({ format: "tallyhand.v2" })).toBe("unknown");
  });
});

describe("parseAndValidateBundle", () => {
  it("accepts a clean modern bundle unchanged", () => {
    const { bundle, migratedFields } = parseAndValidateBundle(validBundle());
    expect(bundle.format).toBe("tallyhand.v1");
    expect(bundle.clients).toHaveLength(1);
    expect(bundle.clients[0].name).toBe("Acme");
    expect(migratedFields).toBe(0);
  });

  it("migrates a legacy bundle missing optional arrays and defaults", () => {
    // How an early-2026 export looked: no track-2/3 arrays, no `archived`
    // on clients, no tags/isBilled on tasks, invoice without status.
    const legacy = {
      format: "tallyhand.v1",
      exportedAt: "2026-04-01T00:00:00.000Z",
      settings: { id: "singleton" },
      clients: [{ id: "cli_1", name: "Acme" }],
      projects: [{ id: "prj_1", clientId: "cli_1", name: "Site" }],
      tasks: [
        {
          id: "tsk_1",
          projectId: "prj_1",
          name: "Work",
          startAt: 100,
          endAt: 200,
          durationMinutes: 60,
        },
      ],
      expenses: [
        { id: "exp_1", date: 100, amount: 9.5, category: "Meals" },
      ],
      invoices: [
        {
          id: "inv_1",
          clientId: "cli_1",
          invoiceNumber: "INV-1",
          issueDate: 100,
          dueDate: 200,
          lineItems: [
            { id: "li_1", description: "Work", quantity: 1, rate: 100, amount: 100 },
          ],
        },
      ],
    };
    const { bundle, migratedFields } = parseAndValidateBundle(legacy);
    expect(migratedFields).toBeGreaterThan(0);

    const client = bundle.clients[0];
    expect(client.archived).toBe(false);
    expect(client.createdAt).toBe(0);

    const task = bundle.tasks[0];
    expect(task.tags).toEqual([]);
    expect(task.isBilled).toBe(false);

    const expense = bundle.expenses[0];
    expect(expense.isBilled).toBe(false);

    const invoice = bundle.invoices[0];
    expect(invoice.status).toBe("draft");
    expect(invoice.subtotal).toBe(100);
    expect(invoice.total).toBe(100);

    // Optional arrays default to empty.
    expect(bundle.recurringSchedules).toEqual([]);
    expect(bundle.rateCards).toEqual([]);
  });

  it("rejects a ledger export with a helpful message", () => {
    expect(() =>
      parseAndValidateBundle({ format: "tallyhand.ledger.v1", rows: [] }),
    ).toThrow(/ledger export/i);
  });

  it("rejects non-bundle payloads", () => {
    expect(() => parseAndValidateBundle({ format: "nope" })).toThrow(
      /not a tallyhand backup/i,
    );
    expect(() => parseAndValidateBundle(null)).toThrow(/not a tallyhand backup/i);
  });

  it("rejects entities with wrong field types, naming the offender", () => {
    const bad = validBundle();
    (bad.clients as unknown[]).push({
      id: "cli_2",
      name: 42, // wrong type
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(() => parseAndValidateBundle(bad)).toThrow(/clients\.1\.name/);
  });

  it("rejects entities missing their id", () => {
    const bad = validBundle();
    (bad.tasks as unknown[]).push({
      projectId: "prj_1",
      name: "No id",
      startAt: 1,
      endAt: 2,
      durationMinutes: 1,
    });
    expect(() => parseAndValidateBundle(bad)).toThrow(/tasks\.0\.id/);
  });

  it("rejects unknown invoice statuses only after migration normalizes them", () => {
    // Migration coerces unknown status → "draft", so this imports fine.
    const b = validBundle();
    (b.invoices as unknown[]).push({
      id: "inv_9",
      clientId: "cli_1",
      invoiceNumber: "INV-9",
      issueDate: 1,
      dueDate: 2,
      status: "weird",
      lineItems: [],
      subtotal: 0,
      total: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const { bundle } = parseAndValidateBundle(b);
    expect(bundle.invoices[0].status).toBe("draft");
  });

  it("passes through unknown extra fields (forward compatibility)", () => {
    const b = validBundle();
    (b.clients[0] as Record<string, unknown>).someFutureField = "kept";
    const { bundle } = parseAndValidateBundle(b);
    expect(
      (bundle.clients[0] as unknown as Record<string, unknown>).someFutureField,
    ).toBe("kept");
  });
});
