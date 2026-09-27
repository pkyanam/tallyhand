import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiToken, mockGetServerProvider } = vi.hoisted(() => ({
  mockRequireApiToken: vi.fn(),
  mockGetServerProvider: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireApiToken: mockRequireApiToken,
}));
vi.mock("@/server/provider", () => ({
  getServerProvider: mockGetServerProvider,
}));
// Pass straight through the handler — the real wrapper needs a sqlite file.
vi.mock("../../_lib/idempotency", () => ({
  withIdempotency: (_req: Request, handler: () => Promise<Response>) => handler(),
}));

import { POST } from "./route";

const sentInvoice = {
  id: "inv_1",
  invoiceNumber: "INV-001",
  status: "sent",
  total: 123.45,
  currency: "USD",
  clientId: null,
};

function jsonRequest(body: unknown): Request {
  return new Request("https://app.test/api/v1/stripe/payment-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/stripe/payment-links", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let getInvoice: ReturnType<typeof vi.fn>;
  let getSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequireApiToken.mockReturnValue(null);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("TALLYHAND_APP_URL", "https://tally.example.com");
    vi.stubEnv("VERCEL_URL", "");
    getInvoice = vi.fn().mockResolvedValue(sentInvoice);
    getSettings = vi.fn().mockResolvedValue({});
    mockGetServerProvider.mockReturnValue({
      getInvoice,
      getSettings,
      getClient: vi.fn(),
    });
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_test_1",
        url: "https://checkout.stripe.com/pay/cs_test_1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 401 when the API token check fails", async () => {
    const denied = new Response(
      JSON.stringify({ error: { code: "unauthorized" } }),
      { status: 401 },
    );
    mockRequireApiToken.mockReturnValueOnce(denied);
    const res = await POST(jsonRequest({ invoiceId: "inv_1" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await POST(jsonRequest({ invoiceId: "inv_1" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/not configured/i);
  });

  it("returns 400 for an invalid body", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("creates a checkout session and returns the payment link", async () => {
    const res = await POST(jsonRequest({ invoiceId: "inv_1" }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        sessionId: string;
        url: string;
        invoiceId: string;
        invoiceNumber: string;
        amountCents: number;
        currency: string;
      };
    };
    expect(json.data.sessionId).toBe("cs_test_1");
    expect(json.data.url).toBe("https://checkout.stripe.com/pay/cs_test_1");
    expect(json.data.amountCents).toBe(12345);
    expect(json.data.currency).toBe("usd");
    // The Stripe API was called with the full balance and redirect URLs.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const body = String(init.body);
    const enc = encodeURIComponent;
    expect(body).toContain(`${enc("line_items[0][price_data][unit_amount]")}=12345`);
    expect(body).toContain(`${enc("metadata[invoiceId]")}=inv_1`);
    expect(body).toContain(enc("https://tally.example.com"));
  });

  it("maps a missing invoice to 404 and a non-sent invoice to 409", async () => {
    getInvoice.mockResolvedValueOnce(undefined);
    expect((await POST(jsonRequest({ invoiceId: "nope" }))).status).toBe(404);
    getInvoice.mockResolvedValueOnce({ ...sentInvoice, status: "draft" });
    expect((await POST(jsonRequest({ invoiceId: "inv_1" }))).status).toBe(409);
  });

  it("surfaces Stripe API errors as 400 with the stripe code", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({
        error: { message: "Your card was declined.", code: "card_declined" },
      }),
    });
    const res = await POST(jsonRequest({ invoiceId: "inv_1" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string; details: unknown } };
    expect(json.error.message).toMatch(/declined/);
    expect((json.error.details as { code: string }).code).toBe("card_declined");
  });
});
