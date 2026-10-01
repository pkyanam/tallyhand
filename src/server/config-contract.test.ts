import { describe, expect, it } from "vitest";
import { settingsPatchSchema, recurringScheduleCreateSchema } from "./validation";
import { DEFAULT_SETTINGS } from "@/core/entities";
import { badRequest } from "./http";
describe("settings and recurring write contracts", () => {
  it("accepts every writable invoice default returned by settings", () => {
    expect(settingsPatchSchema.safeParse({ invoice: DEFAULT_SETTINGS.invoice }).success).toBe(true);
    expect(settingsPatchSchema.parse({ invoice: { paymentTermsDays: 30, defaultPaymentMethod: "Direct Deposit" } }).invoice).toEqual({ paymentTermsDays: 30, defaultPaymentMethod: "Direct Deposit" });
  });
  it("defaults unbilled line items to an empty list", () => {
    const parsed = recurringScheduleCreateSchema.parse({ clientId: "fixture-client", projectId: "fixture-project", name: "Monthly labor", mode: "unbilled", frequency: "monthly", interval: 1, startDate: "2026-11-01" });
    expect(parsed.lineItems).toEqual([]); expect(parsed.startDate).toBe(Date.UTC(2026,10,1));
  });
  it("identifies invalid nested fields without echoing sensitive values", async () => {
    const parsed = settingsPatchSchema.safeParse({ invoice: { paymentTermsDays: -1, unsupported: "secret value" } });
    if (parsed.success) throw new Error("Expected validation to fail");
    const body = await badRequest("Invalid settings patch", parsed.error.issues).json();
    expect(body.error.details.map((item: { field: string }) => item.field)).toEqual(expect.arrayContaining(["invoice.paymentTermsDays", "invoice.unsupported"]));
    expect(JSON.stringify(body)).not.toContain("secret value");
  });
});
