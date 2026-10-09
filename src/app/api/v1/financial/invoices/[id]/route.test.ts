import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSqliteProvider } from "@/server/sqlite-provider";
const fixture = vi.hoisted(() => ({ context: vi.fn(), timeline: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/auth/request-cache", () => ({ withApiRequestCache: (fn: unknown) => fn }));
vi.mock("@/server/provider", () => ({
  getServerProvider: () => fixture.provider(),
  getServerProviderForUser: () => fixture.provider() ?? ({ getInvoice: async () => ({ id: "invoice" }) }),
}));
vi.mock("@/server/invoice-links", () => ({ withInvoiceLinks: async (invoice: unknown) => invoice }));
vi.mock("../../../_lib/sync-auth", () => ({ requireApiOrSession: async () => null }));
vi.mock("../../../_lib/idempotency", () => ({ withIdempotency: async (_req: unknown, handler: () => Promise<Response>) => handler() }));
vi.mock("../../_lib", () => ({
  financialContext: fixture.context,
  financialPage: () => ({ limit: 50 }),
  financialError: () => new Response(null, { status: 503 }),
}));
import { GET } from "./route";
import { POST as markPaid } from "../../../invoices/[id]/paid/route";

it("does not expose another account or mode, manual assertions, or unrelated audit to a financial grant", async () => {
  const scope = { userId: "owner", workspaceId: "owner", provider: "stripe", accountId: "acct_a", mode: "test" };
  fixture.context.mockResolvedValue({
    authority: { kind: "api-token" }, workspace: { userId: "owner", workspaceId: "owner" }, scope,
    store: { getInvoiceTimeline: fixture.timeline },
  });
  fixture.timeline.mockResolvedValue({
    attempts: [{ id: "a", scope }, { id: "other", scope: { ...scope, accountId: "acct_b" } }],
    payments: [{ id: "p", scope }, { id: "live", scope: { ...scope, mode: "live" } }],
    refunds: [{ id: "r", scope }],
    allocations: [{ id: "alloc", paymentId: "p" }, { id: "hidden", paymentId: "live" }],
    manualEvidence: [{ id: "manual", note: "private" }],
    audit: { items: [{ id: "ok", detail: { paymentId: "p" } }, { id: "secret", detail: { paymentId: "live" } }], nextCursor: "next" },
  });
  const response = await GET(new Request("https://example.test"), { params: { id: "invoice" } });
  const { data } = await response.json();
  expect(data.attempts.map((item: { id: string }) => item.id)).toEqual(["a"]);
  expect(data.payments.map((item: { id: string }) => item.id)).toEqual(["p"]);
  expect(data.manualEvidence).toEqual([]);
  expect(data.allocations.map((item: { id: string }) => item.id)).toEqual(["alloc"]);
  expect(data.audit.items.map((item: { id: string }) => item.id)).toEqual(["ok"]);
});

it("projects a real backend manual mark as user evidence without a Stripe receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "manual-timeline-"));
  try {
    const provider = makeSqliteProvider(join(directory, "store.sqlite"));
    const invoice = await provider.createInvoice({ clientId: "client", invoiceNumber: "MANUAL-1", status: "sent", issueDate: 1, dueDate: 2, lineItems: [], subtotal: 12, total: 12, currency: "EUR" });
    fixture.provider.mockReturnValue(provider);
    const marked = await markPaid(new Request("https://example.test/api/v1/invoices/manual/paid", { method: "POST" }), { params: { id: invoice.id } });
    expect(marked.status).toBe(200);
    fixture.context.mockResolvedValue({ authority: { kind: "owner" }, workspace: { userId: "local", workspaceId: "local" }, store: { getInvoiceTimeline: fixture.timeline } });
    fixture.timeline.mockResolvedValue({ attempts: [], payments: [], refunds: [], allocations: [], manualEvidence: [], audit: { items: [] } });
    const response = await GET(new Request("https://example.test"), { params: { id: invoice.id } });
    const { data } = await response.json();
    expect(data.invoiceStatus).toBe("paid");
    expect(data.manualAssertion).toMatchObject({ source: "manual", actorId: "local", total: 12, currency: "EUR" });
    expect(data.payments).toEqual([]);
    expect(data.manualEvidence).toEqual([]);
  } finally {
    fixture.provider.mockReset();
    rmSync(directory, { recursive: true, force: true });
  }
});
