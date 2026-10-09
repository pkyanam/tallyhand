import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  authority: vi.fn(),
  checkout: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("@/server/provider", () => ({ getServerProvider: m.provider }));
vi.mock("@/server/financial-authority", () => ({
  resolveFinancialRequestAuthority: m.authority,
}));
vi.mock("@/server/stripe-service", () => ({
  createInvoiceCheckoutSession: m.checkout,
}));
import { StripeError } from "@/plugins/stripe/stripe-client";
import { POST } from "./route";
function req(key?: string, body: unknown = { invoiceId: "i" }) {
  return new Request("https://app.test/payment-links", {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : {},
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.authority.mockResolvedValue({
    userId: "u",
    authority: { kind: "owner", userId: "u" },
  });
  m.checkout.mockResolvedValue({
    sessionId: "cs",
    url: "https://checkout.stripe.com/cs",
  });
});
describe("payment link financial boundary", () => {
  it("requires stable operation key before resolving authority", async () => {
    expect((await POST(req())).status).toBe(400);
    expect((await POST(req("bad key"))).status).toBe(400);
    expect(m.authority).not.toHaveBeenCalled();
  });
  it("passes authenticated scope and durable operation identity into orchestration", async () => {
    expect((await POST(req("op"))).status).toBe(201);
    expect(m.checkout).toHaveBeenCalledWith(undefined, "i", {
      userId: "u",
      authority: { kind: "owner", userId: "u" },
      operationId: "op",
      cancelUrl: undefined,
    });
  });
  it("rejects caller-supplied authority or scope fields", async () => {
    expect(
      (await POST(req("op", { invoiceId: "i", userId: "victim" }))).status,
    ).toBe(400);
    expect(m.checkout).not.toHaveBeenCalled();
  });
  it.each([202, 403, 409, 503])(
    "returns honest financial status %s",
    async (status) => {
      m.checkout.mockRejectedValueOnce(new StripeError("outcome", status));
      const r = await POST(req("op"));
      expect(r.status).toBe(status);
      expect(await r.json()).toMatchObject({ error: { message: "outcome" } });
    },
  );
  it("denies machine authority before invoking Stripe", async () => {
    m.authority.mockRejectedValueOnce(
      Object.assign(new Error("grant required"), { status: 403 }),
    );
    expect((await POST(req("op"))).status).toBe(403);
    expect(m.checkout).not.toHaveBeenCalled();
  });
});
