/**
 * stripe-payments — first-party Tallyhand plugin.
 *
 * Wires Stripe Checkout into the public invoice portal (`/share/[token]`):
 * - registers `onSharePaymentRequested` so the portal Pay button redirects
 *   to a Stripe-hosted Checkout Session (Tallyhand never sees card data);
 * - declares a settings section (master switch, statement descriptor).
 *
 * Webhook handling lives in `src/app/api/v1/stripe/webhook/route.ts`, which
 * verifies the Stripe signature and commits the inbox and financial outcomes
 * before projecting invoice status and delivering notifications from the outbox.
 *
 * Hosted accounts use explicit Stripe Connect records with encrypted credentials.
 * Self-hosted collection can use `STRIPE_SECRET_KEY` in the server environment.
 * - `STRIPE_WEBHOOK_SECRET` (required for the webhook route).
 * - `TALLYHAND_APP_URL` (or `NEXT_PUBLIC_APP_URL`) — absolute base URL for
 *   checkout success/cancel redirects. On Vercel this falls back to
 *   `VERCEL_URL` automatically.
 *
 * The plugin talks to Stripe over plain HTTPS (`./stripe-client`) — no
 * `stripe` npm package needed at runtime. `peerDependencies` pins the SDK
 * version the API calls were written against (stripe@22.6.2).
 */

import { onSharePaymentRequested } from "@/lib/share/payment-slot";
import { getServerProviderForUser } from "@/server/provider";
import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken } from "@/lib/share/service";
import {
  createInvoiceCheckoutSession,
  getStripeConfig,
} from "@/server/stripe-service";
import type { Plugin } from "../types";

export const STRIPE_PLUGIN_NAME = "stripe-payments";
export const STRIPE_PLUGIN_VERSION = "0.1.0";

export const stripePlugin: Plugin = {
  manifest: {
    name: STRIPE_PLUGIN_NAME,
    version: STRIPE_PLUGIN_VERSION,
    description:
      "Stripe Checkout for the client invoice portal, with webhook-driven payment confirmation.",
    peerDependencies: { stripe: "22.6.2" },
  },

  activate(ctx) {
    // Secrets are env-only. Without a secret key the plugin registers
    // nothing payment-related, so hasSharePaymentHandler() stays false and
    // the portal shows its "payments not configured" state.
    if (
      !getStripeConfig() &&
      !(
        process.env.STRIPE_CONNECT_CLIENT_ID && process.env.TALLY_ENCRYPTION_KEY
      )
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        "[stripe-payments] STRIPE_SECRET_KEY is not set — portal payments stay disabled.",
      );
      return;
    }

    onSharePaymentRequested(async (req) => {
      const resolved = await resolveShareToken(
        getShareDeps(),
        req.shareToken,
        "invoice",
      );
      if (
        resolved.link.userId !== req.ownerId ||
        resolved.link.id !== req.shareLinkId ||
        resolved.invoice?.id !== req.invoiceId
      ) {
        throw Object.assign(new Error("Invoice payment capability mismatch"), {
          status: 403,
        });
      }
      const provider = getServerProviderForUser(req.ownerId);
      const checkout = await createInvoiceCheckoutSession(
        provider,
        req.invoiceId,
        {
          shareToken: req.shareToken,
          userId: req.ownerId,
          authority: { kind: "customer", shareToken: req.shareToken },
          operationId: req.operationId,
        },
      );
      return { checkoutUrl: checkout.url };
    });

    ctx.settings.registerSection({
      id: "stripe-payments.settings",
      title: "Stripe payments",
      description:
        "Online invoice payments through an explicit Stripe account connection. Connection credentials are encrypted on the server.",
      fields: [
        {
          key: "enabled",
          label: "Accept online payments",
          type: "boolean",
          defaultValue: true,
          description:
            "Master switch. Turn off to hide the portal Pay button without removing the API key.",
        },
        {
          key: "statementDescriptor",
          label: "Statement descriptor",
          type: "string",
          defaultValue: "",
          description:
            "Optional text on the payer's card statement (max 22 chars).",
        },
      ],
    });

    ctx.hooks.on("onPaymentReceived", async ({ invoice }) => {
      // eslint-disable-next-line no-console
      console.info(
        `[stripe-payments] payment received for invoice ${invoice.invoiceNumber}`,
      );
    });
  },
};
