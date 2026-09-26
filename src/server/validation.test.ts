import { describe, expect, it } from "vitest";
import {
  clientCreateSchema,
  expenseCreateSchema,
  invoiceCreateSchema,
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
    it("rejects bad status enum and line item without description", () => {
      expect(
        invoiceCreateSchema.safeParse({
          clientId: "c",
          issueDate: 1,
          dueDate: 2,
          lineItems: [],
          status: "emailed",
        }).success,
      ).toBe(false);
      expect(
        invoiceCreateSchema.safeParse({
          clientId: "c",
          issueDate: 1,
          dueDate: 2,
          lineItems: [{ quantity: 1, rate: 1 }],
        }).success,
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
