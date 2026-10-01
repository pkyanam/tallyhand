import { it, expect, vi } from "vitest";
vi.mock("../_lib/sync-auth", () => ({ requireApiOrSession: async () => null }));
vi.mock("../_lib/idempotency", () => ({ withIdempotency: async (_req: Request, fn: () => Promise<Response>) => fn() }));
vi.mock("@/server/provider", () => ({ getServerProvider: () => ({
  getClient: async () => ({ id: "fixture-client" }),
  getSettings: async () => ({ invoice: { paymentTermsDays: 30, defaultTaxRate: 10, defaultCurrency: "USD", defaultTaxRegion: "US", defaultPaymentMethod: "Direct Deposit" } }),
  assignNextInvoiceNumber: async () => "FIXTURE-1",
  createInvoice: async (input: unknown) => input,
}) }));
import { POST } from "./route";
it("derives terms, payment method and taxed totals when agents omit defaults", async () => {
  const res = await POST(new Request("https://fixture.example/api/v1/invoices", { method: "POST", body: JSON.stringify({ clientId: "fixture-client", issueDate: 1000, lineItems: [{ description: "Fixture", quantity: 1, rate: 100 }] }) }));
  expect(res.status).toBe(201);
  const { data } = await res.json();
  expect(data).toMatchObject({ dueDate: 1000 + 30*86400000, paymentMethod: "Direct Deposit", subtotal: 100, total: 110, status: "draft" });
});
it("honors an explicit valid due date", async () => {
  const res = await POST(new Request("https://fixture.example/api/v1/invoices", { method: "POST", body: JSON.stringify({ clientId: "fixture-client", issueDate: 1000, dueDate: 2000, lineItems: [] }) }));
  expect((await res.json()).data.dueDate).toBe(2000);
});
