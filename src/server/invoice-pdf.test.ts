import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { invoicePdfResponse } from "./invoice-pdf";
import { DEFAULT_SETTINGS, type Invoice } from "@/core/entities";
it("renders a real PDF using the application template", async () => {
  const invoice: Invoice = { id: "fixture", clientId: "client", invoiceNumber: "DEMO-1001", issueDate: 1790899200000, dueDate: 1793491200000, status: "draft", lineItems: [{ id: "line", description: "Product design", quantity: 8, rate: 60, amount: 480, sourceType: "manual" }], subtotal: 480, total: 480, currency: "USD", paymentMethod: "Direct Deposit", createdAt: 0, updatedAt: 0 };
  const response = await invoicePdfResponse(invoice, { ...DEFAULT_SETTINGS, business: { ...DEFAULT_SETTINGS.business, name: "Example Studio", ownerName: "Alex Morgan", email: "alex@example.com" } }, { id: "client", name: "Example Client", email: "client@example.com", createdAt: 0, updatedAt: 0 });
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  if (process.env.TALLY_PDF_FIXTURE_PATH) writeFileSync(process.env.TALLY_PDF_FIXTURE_PATH, bytes);
});
