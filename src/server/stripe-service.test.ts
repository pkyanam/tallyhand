import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "@/core/storage";
import {
  createInvoiceCheckoutSession,
  getStripeConfig,
  stripeKeyMode,
} from "./stripe-service";

const sentInvoice = {
  id: "inv_1",
  invoiceNumber: "INV-001",
  status: "sent",
  total: 123.45,
  currency: "USD",
  clientId: null,
};

function providerFor(invoice: unknown): StorageProvider {
  return {
    getInvoice: vi.fn().mockResolvedValue(invoice),
    getClient: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({}),
  } as unknown as StorageProvider;
}

describe("stripeKeyMode", () => {
  it("classifies test, live, and unknown keys", () => {
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("rk_test_abc")).toBe("test");
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("whsec_abc")).toBe("unknown");
    expect(stripeKeyMode("")).toBe("unknown");
  });
});

describe("getStripeConfig", () => {
  it("returns null without STRIPE_SECRET_KEY (payments stay disabled)", () => {
    expect(getStripeConfig({})).toBeNull();
    expect(getStripeConfig({ STRIPE_SECRET_KEY: "" })).toBeNull();
  });

  it("exposes the key mode", () => {
    expect(
      getStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x" })?.mode,
    ).toBe("test");
    expect(
      getStripeConfig({ STRIPE_SECRET_KEY: "sk_live_x" })?.mode,
    ).toBe("live");
  });

  it("prefers TALLYHAND_APP_URL over NEXT_PUBLIC_APP_URL", () => {
    const cfg = getStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_x",
      TALLYHAND_APP_URL: "https://tally.example.com/",
      NEXT_PUBLIC_APP_URL: "https://other.example.com",
    });
    expect(cfg?.appUrl).toBe("https://tally.example.com");
  });

  it("falls back to VERCEL_URL so fresh Vercel deploys work", () => {
    const cfg = getStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_x",
      VERCEL_URL: "tallyhand-abc.vercel.app",
    });
    expect(cfg?.appUrl).toBe("https://tallyhand-abc.vercel.app");
    // Tolerates an already-absolute VERCEL_URL.
    const cfg2 = getStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_x",
      VERCEL_URL: "https://tallyhand-abc.vercel.app",
    });
    expect(cfg2?.appUrl).toBe("https://tallyhand-abc.vercel.app");
  });
});

describe("createInvoiceCheckoutSession", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("TALLYHAND_APP_URL", "https://tally.example.com");
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_test_1",
        url: "https://checkout.stripe.com/pay/cs_test_1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it("throws a clear error when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(
      createInvoiceCheckoutSession(providerFor(sentInvoice), "inv_1"),
    ).rejects.toThrow(/not configured/);
  });

  it("throws 404 / 409 for missing or non-sent invoices", async () => {
    await expect(
      createInvoiceCheckoutSession(providerFor(undefined), "nope"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createInvoiceCheckoutSession(
        providerFor({ ...sentInvoice, status: "paid" }),
        "inv_1",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("honors the invoice currency and full balance", async () => {
    const checkout = await createInvoiceCheckoutSession(
      providerFor({ ...sentInvoice, currency: "EUR", total: 99.0 }),
      "inv_1",
    );
    expect(checkout.amountCents).toBe(9900);
    expect(checkout.currency).toBe("eur");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain(encodeURIComponent("line_items[0][price_data][currency]") + "=eur");
  });

  it("warns loudly when a live key is used (test mode is the default)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_123");
    await createInvoiceCheckoutSession(providerFor(sentInvoice), "inv_1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/LIVE key/i),
    );
  });

  it("does not warn for test keys", async () => {
    await createInvoiceCheckoutSession(providerFor(sentInvoice), "inv_1");
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/LIVE key/i),
    );
  });

  it("builds portal redirects from the share token", async () => {
    await createInvoiceCheckoutSession(providerFor(sentInvoice), "inv_1", {
      shareToken: "tok_abc",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain(encodeURIComponent("success_url") + "=");
    expect(body).toContain(
      encodeURIComponent("https://tally.example.com/share/tok_abc?paid=1"),
    );
  });
});
