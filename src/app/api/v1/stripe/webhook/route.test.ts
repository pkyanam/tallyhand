import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerProvider, mockGetServerProviderForUser, mockEmit, mockFindUser } = vi.hoisted(() => ({
  mockGetServerProvider: vi.fn(),
  mockGetServerProviderForUser: vi.fn(),
  mockEmit: vi.fn(),
  mockFindUser: vi.fn(),
}));

vi.mock("@/server/provider", () => ({
  getServerProvider: mockGetServerProvider,
  getServerProviderForUser: mockGetServerProviderForUser,
}));
vi.mock("@/lib/stripe-connect/store", () => ({ findUserIdByStripeAccount: mockFindUser }));
vi.mock("@/plugins", () => ({
  pluginRegistry: { emit: mockEmit },
}));

import { POST } from "./route";

const WEBHOOK_SECRET = "whsec_test_123";

function sign(rawBody: string, secret: string, timestamp: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function signedRequest(body: string, secret = WEBHOOK_SECRET): Request {
  const ts = Math.floor(Date.now() / 1000);
  return new Request("https://app.test/api/v1/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": sign(body, secret, ts) },
    body,
  });
}

const baseSession = {
  id: "cs_test_1",
  amount_total: 12345,
  currency: "usd",
  payment_status: "paid",
  metadata: { invoiceId: "inv_1", invoiceNumber: "INV-001" },
};

function sessionEvent(session: Record<string, unknown>): string {
  return JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: session },
  });
}

describe("POST /api/v1/stripe/webhook", () => {
  let markInvoicePaid: ReturnType<typeof vi.fn>;
  let getInvoice: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    markInvoicePaid = vi.fn().mockResolvedValue(undefined);
    getInvoice = vi.fn();
    mockGetServerProvider.mockReset();
    mockGetServerProvider.mockReturnValue({
      getInvoice,
      markInvoicePaid,
    });
    mockGetServerProviderForUser.mockReturnValue({getInvoice,markInvoicePaid});
    mockFindUser.mockReset();
    mockEmit.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await POST(new Request("https://app.test/api/v1/stripe/webhook", { method: "POST" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/not configured/i);
  });

  it("rejects a missing signature", async () => {
    const body = sessionEvent(baseSession);
    const res = await POST(
      new Request("https://app.test/api/v1/stripe/webhook", {
        method: "POST",
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; details: { code: string } };
    };
    expect(json.error.details.code).toBe("invalid_signature");
  });

  it("rejects a forged signature", async () => {
    const body = sessionEvent(baseSession);
    const res = await POST(signedRequest(body, "whsec_wrong"));
    expect(res.status).toBe(400);
  });

  it("marks the invoice paid on a valid checkout.session.completed", async () => {
    const invoice = {
      id: "inv_1",
      invoiceNumber: "INV-001",
      status: "sent",
      total: 123.45,
      currency: "USD",
    };
    getInvoice.mockResolvedValueOnce(invoice).mockResolvedValueOnce({
      ...invoice,
      status: "paid",
    });
    const res = await POST(signedRequest(sessionEvent(baseSession)));
    expect(res.status).toBe(200);
    expect(markInvoicePaid).toHaveBeenCalledWith("inv_1");
    expect(mockEmit).toHaveBeenCalledWith(
      "onInvoicePaid",
      expect.objectContaining({ id: "inv_1" }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      "onPaymentReceived",
      expect.objectContaining({ provider: "stripe", externalId: "cs_test_1" }),
    );
    const json = (await res.json()) as { data: { type: string } };
    expect(json.data.type).toBe("checkout.session.completed");
  });

  it("is a no-op for an already-paid invoice (Stripe retries)", async () => {
    getInvoice.mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "INV-001",
      status: "paid",
      total: 123.45,
      currency: "USD",
    });
    const res = await POST(signedRequest(sessionEvent(baseSession)));
    expect(res.status).toBe(200);
    expect(markInvoicePaid).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("skips sessions whose amount is below the invoice total", async () => {
    getInvoice.mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "INV-001",
      status: "sent",
      total: 123.45,
      currency: "USD",
    });
    const short = { ...baseSession, amount_total: 100 };
    const res = await POST(signedRequest(sessionEvent(short)));
    expect(res.status).toBe(200);
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it("skips sessions with a mismatched currency or unpaid status", async () => {
    getInvoice.mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "INV-001",
      status: "sent",
      total: 123.45,
      currency: "USD",
    });
    for (const tweak of [
      { currency: "eur" },
      { payment_status: "unpaid" },
    ]) {
      markInvoicePaid.mockClear();
      const res = await POST(
        signedRequest(sessionEvent({ ...baseSession, ...tweak })),
      );
      expect(res.status).toBe(200);
      expect(markInvoicePaid).not.toHaveBeenCalled();
    }
  });

  it("honors the invoice currency (not hardcoded USD)", async () => {
    getInvoice.mockResolvedValueOnce({
      id: "inv_2",
      invoiceNumber: "INV-002",
      status: "sent",
      total: 99.0,
      currency: "EUR",
    }).mockResolvedValueOnce({
      id: "inv_2",
      invoiceNumber: "INV-002",
      status: "paid",
      total: 99.0,
      currency: "EUR",
    });
    const eurSession = {
      ...baseSession,
      id: "cs_eur_1",
      amount_total: 9900,
      currency: "eur",
      metadata: { invoiceId: "inv_2", invoiceNumber: "INV-002" },
    };
    const res = await POST(signedRequest(sessionEvent(eurSession)));
    expect(res.status).toBe(200);
    expect(markInvoicePaid).toHaveBeenCalledWith("inv_2");
  });

  it("acknowledges unhandled event types without action", async () => {
    const body = JSON.stringify({ id: "evt_2", type: "invoice.paid" });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    expect(mockGetServerProvider).not.toHaveBeenCalled();
    const json = (await res.json()) as { data: { type: string } };
    expect(json.data.type).toBe("invoice.paid");
  });

  it("rejects an invalid JSON payload after signature verification", async () => {
    const res = await POST(signedRequest("not json{{"));
    expect(res.status).toBe(400);
  });

  it("routes connected events to the owning user's provider", async () => {
    mockFindUser.mockResolvedValue("owner");
    getInvoice.mockResolvedValue({id:"inv_1",invoiceNumber:"INV-001",status:"sent",total:123.45,currency:"usd"}).mockResolvedValueOnce({id:"inv_1",invoiceNumber:"INV-001",status:"sent",total:123.45,currency:"usd"}).mockResolvedValueOnce({id:"inv_1",invoiceNumber:"INV-001",status:"paid",total:123.45,currency:"usd"});
    const e=JSON.parse(sessionEvent(baseSession));e.account="acct_123";
    await POST(signedRequest(JSON.stringify(e)));
    expect(mockGetServerProviderForUser).toHaveBeenCalledWith("owner");
  });
  it("acks unknown connected accounts without touching invoices", async () => {
    mockFindUser.mockResolvedValue(null); const e=JSON.parse(sessionEvent(baseSession));e.account="acct_unknown";
    const res=await POST(signedRequest(JSON.stringify(e)));
    expect(res.status).toBe(200);expect(getInvoice).not.toHaveBeenCalled();
  });
});
