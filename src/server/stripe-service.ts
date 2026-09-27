/**
 * SERVER ONLY — never import from client components.
 *
 * Stripe orchestration shared by the stripe-payments plugin (portal pay
 * flow) and the `/api/v1/stripe/payment-links` route.
 *
 * The secret key comes from the `STRIPE_SECRET_KEY` environment variable
 * ONLY — it is never read from plugin settings, never logged, and never
 * persisted.
 */

import type { Invoice } from "@/core/entities";
import type { StorageProvider } from "@/core/storage";
import { shareUrl } from "@/lib/share/service";
import {
  createCheckoutSession,
  StripeError,
} from "@/plugins/stripe/stripe-client";

export { getStripeConfig, stripeKeyMode } from "./stripe-config";
export type { StripeConfig, StripeKeyMode } from "./stripe-config";
import { getStripeConfig } from "./stripe-config";

/** Plugin-settings key under Settings.pluginSettings. */
export const STRIPE_SETTINGS_KEY = "stripe-payments";

export interface StripePluginSettings {
  enabled?: boolean;
  statementDescriptor?: string;
}

export async function getStripePluginSettings(
  provider: StorageProvider,
): Promise<StripePluginSettings> {
  const settings = await provider.getSettings();
  const raw = settings.pluginSettings?.[STRIPE_SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    statementDescriptor:
      typeof raw.statementDescriptor === "string"
        ? raw.statementDescriptor
        : undefined,
  };
}

export interface InvoiceCheckoutOptions {
  /** Share token when the session is started from the client portal. */
  shareToken?: string;
  /** Override the cancel redirect (defaults to the portal/invoice page). */
  cancelUrl?: string;
  userId?: string;
}

export interface InvoiceCheckout {
  sessionId: string;
  url: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
}

/**
 * Create a Stripe Checkout Session collecting the full balance of a sent
 * invoice. Throws bad-request-style Errors for invalid invoice state and
 * StripeError for API failures.
 */
export async function createInvoiceCheckoutSession(
  provider: StorageProvider,
  invoiceId: string,
  opts: InvoiceCheckoutOptions = {},
): Promise<InvoiceCheckout> {
  const { resolveCheckoutStripeKey } = await import("./stripe-connect");
  const resolved = await resolveCheckoutStripeKey(opts.userId);
  // appUrl is derived from the environment independently of which secret
  // key resolved: a Connect-only deployment (no STRIPE_SECRET_KEY) still
  // needs redirect URLs.
  const appConfig = getStripeConfig();
  const appUrl =
    appConfig?.appUrl ??
    (
      process.env.TALLYHAND_APP_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
        : "")
    ).replace(/\/+$/, "");
  const config = { secretKey: resolved.secretKey, mode: resolved.mode, appUrl };
  if (config.mode === "live") {
    // Test mode is the documented default. Live keys work, but charging
    // real money is never silent.
    // eslint-disable-next-line no-console
    console.warn(
      `[stripe] resolved Stripe key (${resolved.source}) is a LIVE key — Checkout sessions will charge real money.`,
    );
  }
  const pluginSettings = await getStripePluginSettings(provider);
  if (pluginSettings.enabled === false) {
    throw new Error("Stripe payments are disabled in plugin settings.");
  }

  const invoice: Invoice | undefined = await provider.getInvoice(invoiceId);
  if (!invoice) {
    const err = new Error(`Invoice "${invoiceId}" not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (invoice.status !== "sent") {
    const err = new Error(
      `Invoice ${invoice.invoiceNumber} is ${invoice.status} — only sent invoices can be paid online`,
    );
    (err as { status?: number }).status = 409;
    throw err;
  }

  const amountCents = Math.round(invoice.total * 100);
  if (amountCents <= 0) {
    throw new Error(
      `Invoice ${invoice.invoiceNumber} has no balance to collect`,
    );
  }

  const currency = (invoice.currency ?? "usd").toLowerCase();
  const client = invoice.clientId
    ? await provider.getClient(invoice.clientId)
    : undefined;

  // Redirects: back to the client portal when started there, otherwise the
  // app root. Stripe requires absolute URLs, so a missing base is a hard
  // configuration error rather than a broken session.
  const base =
    opts.shareToken && config.appUrl
      ? shareUrl(config.appUrl, opts.shareToken)
      : config.appUrl;
  if (!base) {
    throw new Error(
      "Cannot build Stripe redirect URLs — set TALLYHAND_APP_URL (or NEXT_PUBLIC_APP_URL) in the environment.",
    );
  }
  const successUrl = base + (opts.shareToken ? "?paid=1" : "");
  const cancelUrl = opts.cancelUrl ?? base;

  try {
    const session = await createCheckoutSession(config.secretKey, {
      amountCents,
      currency,
      stripeAccount: resolved.stripeAccount ?? undefined,
      productName: `Invoice ${invoice.invoiceNumber}`,
      description: `Tallyhand invoice ${invoice.invoiceNumber}`,
      customerEmail: client?.email || undefined,
      successUrl,
      cancelUrl,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ...(opts.shareToken ? { shareToken: opts.shareToken } : {}),
        // Attribution for Connect payments: which connected account this
        // session was created for (the secret key used is already the
        // connected account's own key).
        ...(resolved.stripeAccount
          ? { stripeAccount: resolved.stripeAccount }
          : {}),
      },
      statementDescriptor: pluginSettings.statementDescriptor,
    });
    return {
      sessionId: session.id,
      url: session.url,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amountCents,
      currency,
    };
  } catch (err) {
    if (err instanceof StripeError) throw err;
    throw new StripeError(
      err instanceof Error ? err.message : "Stripe request failed",
      502,
    );
  }
}
