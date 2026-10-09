/**
 * SERVER ONLY — never import from client components.
 *
 * Stripe orchestration shared by the stripe-payments plugin (portal pay
 * flow) and the `/api/v1/stripe/payment-links` route.
 *
 * Credentials come from an explicit encrypted account connection, or a
 * configured self-hosted environment key. They are never read from browser
 * plugin settings or logged.
 */

import { createHash, randomUUID } from "node:crypto";
import { snapshotInvoice, invoiceFingerprint } from "@/core/financial/snapshot";
import { getFinancialStore } from "./financial-store";
import {
  authorizeFinancial,
  type FinancialAuthority,
} from "./financial-authority";
import type { FinancialScope } from "@/core/financial/types";
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
  userId: string;
  authority: FinancialAuthority;
  operationId: string;
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
  opts: InvoiceCheckoutOptions,
): Promise<InvoiceCheckout> {
  if (!opts?.userId || !opts.authority || !opts.operationId)
    throw new StripeError(
      "Financial authority and operation identity required",
      403,
    );
  const { resolveCheckoutStripeKey, getConnectAccount } =
    await import("./stripe-connect");
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

  const frozen = snapshotInvoice(invoice);
  const amountCents = frozen.money.minorUnits;
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

  const accountId =
    resolved.stripeAccount ?? (await getConnectAccount(resolved.secretKey)).id;
  const scope: FinancialScope = {
    userId: opts.userId,
    workspaceId: opts.userId,
    provider: "stripe",
    accountId,
    mode: resolved.mode as "test" | "live",
  };
  const resource = { invoiceId, money: frozen.money };
  const authorization = await authorizeFinancial(
    "collect",
    opts.authority,
    scope,
    resource,
  );
  const store = await persistence(() => getFinancialStore(opts.userId));
  const prepared = await persistence(() =>
    store.prepareAttempt({
      scope,
      invoice: frozen,
      operationId: opts.operationId,
      requestFingerprint: invoiceFingerprint({ frozen, successUrl, cancelUrl }),
      actor: authorization.actor,
      authorityProof: authorization.proof,
      capabilityProof: authorization.capabilityProof,
      now: Date.now(),
    }),
  );
  const checkout = (a: typeof prepared.attempt): InvoiceCheckout => {
    if (a.state === "failed")
      throw new StripeError(
        "Payment attempt is terminal; use a new operation identity",
        409,
      );
    if (!a.checkoutUrl || !a.checkoutSessionId)
      throw new StripeError("Payment attempt is awaiting reconciliation", 202);
    return {
      sessionId: a.checkoutSessionId,
      url: a.checkoutUrl,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amountCents,
      currency,
    };
  };
  if (prepared.attempt.state !== "prepared") return checkout(prepared.attempt);
  const dispatchAuthorization = await authorizeFinancial(
    "collect",
    opts.authority,
    scope,
    resource,
  );
  const current = await provider.getInvoice(invoiceId);
  if (!current || snapshotInvoice(current).fingerprint !== frozen.fingerprint)
    throw new StripeError("Invoice changed before payment dispatch", 409);
  const now = Date.now(),
    lease = { token: randomUUID(), expiresAt: now + 30_000 };
  const claim = {
    scope,
    id: prepared.attempt.id,
    now,
    lease,
    dispatchActor: dispatchAuthorization.actor,
    authorityProof: dispatchAuthorization.proof,
    capabilityProof: dispatchAuthorization.capabilityProof,
  };
  const attempt = await persistence(() => store.claimAttemptDispatch(claim));
  if (!attempt)
    return checkout(
      (await store.getAttempt(scope, prepared.attempt.id)) ?? prepared.attempt,
    );
  try {
    const session = await createCheckoutSession(config.secretKey, {
      idempotencyKey: attempt.providerIdempotencyKey,
      amountCents,
      currency,
      stripeAccount: resolved.stripeAccount ?? undefined,
      productName: `Invoice ${invoice.invoiceNumber}`,
      description: `Tallyhand invoice ${invoice.invoiceNumber}`,
      customerEmail: client?.email || undefined,
      successUrl,
      cancelUrl,
      metadata: {
        attemptId: attempt.id,
        invoiceFingerprint: createHash("sha256")
          .update(frozen.fingerprint)
          .digest("hex"),
        accountId,
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
    const saved = await store.recordAttemptDispatch({
      ...claim,
      result: {
        state: "pending",
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
      },
    });
    return checkout(saved);
  } catch {
    // A timeout, malformed response or provider error may follow successful creation.
    try {
      await store.recordAttemptDispatch({
        ...claim,
        result: {
          state: "unknown",
          failure: "Stripe dispatch outcome uncertain",
        },
      });
    } catch {
      throw new StripeError(
        "Payment persistence unavailable; reconciliation required",
        503,
      );
    }
    throw new StripeError("Payment attempt is awaiting reconciliation", 202);
  }
}

async function persistence<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      error instanceof Error &&
      /conflict|mismatch|must be sent|missing|denied|revoked|expired/i.test(
        error.message,
      )
    )
      throw new StripeError(error.message, 409);
    throw new StripeError("Financial persistence unavailable", 503);
  }
}
