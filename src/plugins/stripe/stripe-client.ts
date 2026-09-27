/**
 * Minimal Stripe REST client — dependency-free.
 *
 * Uses the Stripe HTTP API directly (form-encoded POSTs + node:crypto for
 * webhook signatures) so the plugin works without installing the `stripe`
 * npm package (pinned peer version: stripe@22.6.2 — see the manifest).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export interface CheckoutSessionParams {
  amountCents: number;
  currency: string;
  productName: string;
  description?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  stripeAccount?: string;
  statementDescriptor?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export class StripeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly stripeCode?: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/**
 * Create a hosted Checkout Session for a one-time payment.
 * Throws StripeError on API failure.
 */
export async function createCheckoutSession(
  secretKey: string,
  params: CheckoutSessionParams,
): Promise<CheckoutSession> {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price_data][currency]", params.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(params.amountCents));
  form.set(
    "line_items[0][price_data][product_data][name]",
    params.productName,
  );
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  for (const [key, value] of Object.entries(params.metadata)) {
    form.set(`metadata[${key}]`, value);
  }
  if (params.description) {
    form.set("payment_intent_data[description]", params.description);
  }
  if (params.customerEmail) {
    form.set("customer_email", params.customerEmail);
  }
  if (params.statementDescriptor) {
    form.set(
      "payment_intent_data[statement_descriptor]",
      params.statementDescriptor,
    );
  }

  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(params.stripeAccount ? { "stripe-account": params.stripeAccount } : {}),
    },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => null)) as {
    id?: string;
    url?: string | null;
    error?: { message?: string; code?: string };
  } | null;

  if (!res.ok) {
    throw new StripeError(
      body?.error?.message ?? `Stripe API error (HTTP ${res.status})`,
      res.status,
      body?.error?.code,
    );
  }
  if (!body?.id || !body.url) {
    throw new StripeError(
      "Stripe created a session without a checkout URL",
      res.status,
    );
  }
  return { id: body.id, url: body.url };
}

/**
 * Verify a Stripe webhook signature header (`stripe-signature`).
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 using the webhook
 * endpoint secret; the header carries `t=<ts>,v1=<hex>[,v1=<hex>...]`.
 * Returns false when the header is malformed, no v1 signature matches, or
 * the timestamp is older than `toleranceSec` (default 300s, replay guard).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSec = 300,
): boolean {
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const v1Sigs: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) {
      const n = Number(value);
      if (Number.isInteger(n)) timestamp = n;
    } else if (key === "v1" && value) {
      v1Sigs.push(value);
    }
  }
  if (timestamp === null || v1Sigs.length === 0) return false;

  const ageSec = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSec > toleranceSec) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return v1Sigs.some((sig) => {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
