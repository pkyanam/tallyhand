import { describe, expect, it } from "vitest";
import {
  clientCreateSchema,
  expenseCreateSchema,
  invoiceCreateSchema,
  invoicePatchSchema,
  projectCreateSchema,
  recurringScheduleCreateSchema,
  retainerCreateSchema,
  settingsPatchSchema,
  taskCreateSchema,
} from "@/server/validation";

describe("validation schemas", () => {
  describe("clients", () => {
    it("accepts a valid client", () => {
      const r = clientCreateSchema.safeParse({ name: "Acme", defaultRate: 150 });
      expect(r.success).toBe(true);
    });
    it("rejects missing name, bad email, negative rate, unknown keys", () => {
      expect(clientCreateSchema.safeParse({}).success).toBe(false);
      expect(clientCreateSchema.safeParse({ name: "x", email: "nope" }).success).toBe(false);
      expect(clientCreateSchema.safeParse({ name: "x", defaultRate: -1 }).success).toBe(false);
      expect(clientCreateSchema.safeParse({ name: "x", bogus: 1 }).success).toBe(false);
    });
  });

  describe("projects", () => {
    it("accepts valid, rejects missing clientId", () => {
      expect(projectCreateSchema.safeParse({ clientId: "cli_1", name: "Site" }).success).toBe(true);
      expect(projectCreateSchema.safeParse({ name: "Site" }).success).toBe(false);
    });
  });

  describe("tasks", () => {
    it("accepts ms numbers and coerces ISO date strings", () => {
      const r = taskCreateSchema.safeParse({
        projectId: "prj_1",
        name: "work",
        startAt: "2026-09-26T09:00:00Z",
        endAt: "2026-09-26T10:00:00Z",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.startAt).toBe(Date.parse("2026-09-26T09:00:00Z"));
        expect(typeof r.data.endAt).toBe("number");
      }
    });
    it("rejects garbage dates and missing fields", () => {
      expect(
        taskCreateSchema.safeParse({ projectId: "p", name: "n", startAt: "not-a-date", endAt: 1 }).success,
      ).toBe(false);
      expect(taskCreateSchema.safeParse({ name: "n" }).success).toBe(false);
    });
  });

  describe("expenses", () => {
    it("accepts valid, rejects negative amount and missing category", () => {
      expect(
        expenseCreateSchema.safeParse({ date: 1000, amount: 42.5, category: "Travel" }).success,
      ).toBe(true);
      expect(
        expenseCreateSchema.safeParse({ date: 1000, amount: -5, category: "Travel" }).success,
      ).toBe(false);
      expect(expenseCreateSchema.safeParse({ date: 1000, amount: 5 }).success).toBe(false);
    });
  });

  describe("invoices", () => {
    it("accepts a minimal invoice with line items", () => {
      const r = invoiceCreateSchema.safeParse({
        clientId: "cli_1",
        issueDate: 1000,
        dueDate: 2000,
        lineItems: [{ description: "work", quantity: 2, rate: 150 }],
      });
      expect(r.success).toBe(true);
    });
    it("accepts a full localization/payment payload", () => {
      const r = invoiceCreateSchema.safeParse({
        clientId: "cli_1",
        issueDate: 1000,
        dueDate: 2000,
        lineItems: [{ description: "work", quantity: 2, rate: 150, taxRate: 8.5, taxLabel: "NY sales tax" }],
        currency: "eur",
        taxRegion: "EU",
        sellerTaxId: "DE123456789",
        sellerTaxIdLabel: "USt-IdNr.",
        buyerTaxId: "FR987654321",
        sellerEmailVisible: false,
        buyerEmailVisible: true,
        serviceStart: "2026-09-01",
        serviceEnd: "2026-09-30",
        invoiceType: "Proforma invoice",
        paymentMethod: "Bank transfer",
        paymentUrl: "https://pay.example.com/i/1",
        bankAccount: "DE89370400440532013000",
        swiftBic: "COBADEFFXXX",
        qrEnabled: true,
        qrPayload: "https://pay.example.com/i/1",
        qrDescription: "Scan to pay",
        amountInWords: true,
        template: "stripe",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.currency).toBe("eur");
        expect(r.data.taxRegion).toBe("EU");
        expect(r.data.serviceStart).toBe(Date.parse("2026-09-01"));
        expect(r.data.lineItems[0].taxRate).toBe(8.5);
      }
    });
    it("rejects out-of-range taxRate, bad currency, and unknown keys", () => {
      const base = {
        clientId: "c",
        issueDate: 1,
        dueDate: 2,
        lineItems: [{ description: "work", quantity: 1, rate: 100 }],
      };
      expect(
        invoiceCreateSchema.safeParse({
          ...base,
          lineItems: [{ description: "work", quantity: 1, rate: 100, taxRate: 101 }],
        }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({ ...base, currency: "USDD" }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({ ...base, currency: "U" }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({ ...base, taxRegion: "UK" }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({ ...base, template: "fancy" }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({ ...base, someUnknownField: 1 }).success,
      ).toBe(false);
    });
    it("patch schema accepts new localization fields and rejects bad ones", () => {
      expect(
        invoicePatchSchema.safeParse({
          currency: "GBP",
          taxRegion: "EU",
          paymentMethod: "Card",
          qrEnabled: true,
          amountInWords: false,
          template: "default",
          lineItems: [{ description: "w", quantity: 1, rate: 10, taxRate: 20, taxLabel: "VAT 20%" }],
        }).success,
      ).toBe(true);
      expect(invoicePatchSchema.safeParse({ currency: "EURO" }).success).toBe(false);
      expect(
        invoicePatchSchema.safeParse({ lineItems: [{ description: "w", quantity: 1, rate: 10, taxRate: -1 }] }).success,
      ).toBe(false);
    });
  });

  describe("recurring schedules", () => {
    const base = {
      clientId: "cli_1",
      name: "Monthly",
      mode: "fixed",
      frequency: "monthly",
      interval: 1,
      lineItems: [{ description: "Retainer", quantity: 1, rate: 2000 }],
      startDate: 1000,
    };
    it("accepts valid fixed and unbilled schedules", () => {
      expect(recurringScheduleCreateSchema.safeParse(base).success).toBe(true);
      expect(
        recurringScheduleCreateSchema.safeParse({ ...base, mode: "unbilled", lineItems: [] }).success,
      ).toBe(true);
    });
    it("rejects zero interval and bad enums", () => {
      expect(recurringScheduleCreateSchema.safeParse({ ...base, interval: 0 }).success).toBe(false);
      expect(recurringScheduleCreateSchema.safeParse({ ...base, frequency: "fortnightly" }).success).toBe(false);
      expect(recurringScheduleCreateSchema.safeParse({ ...base, mode: "sometimes" }).success).toBe(false);
    });
  });

  describe("retainers", () => {
    it("accepts valid, rejects negative amountCents", () => {
      expect(
        retainerCreateSchema.safeParse({
          clientId: "cli_1",
          name: "Block",
          type: "prepaid-hours",
          totalHours: 40,
          amountCents: 600000,
          startDate: 1000,
        }).success,
      ).toBe(true);
      expect(
        retainerCreateSchema.safeParse({
          clientId: "cli_1",
          name: "Block",
          type: "prepaid-hours",
          amountCents: -1,
          startDate: 1000,
        }).success,
      ).toBe(false);
    });
  });

  describe("settings patch", () => {
    it("accepts deep-partial patches, rejects unknown keys and bad enums", () => {
      expect(
        settingsPatchSchema.safeParse({ invoice: { paymentTermsDays: 30 } }).success,
      ).toBe(true);
      expect(settingsPatchSchema.safeParse({ invoice: { nope: 1 } }).success).toBe(false);
      expect(settingsPatchSchema.safeParse({ appearance: { theme: "neon" } }).success).toBe(false);
      expect(settingsPatchSchema.safeParse({ reckoning: { dayOfWeek: 9 } }).success).toBe(false);
    });
  });
});
