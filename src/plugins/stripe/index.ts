/**
 * stripe-payments — first-party Tallyhand plugin.
 *
 * Wires Stripe Checkout into the public invoice portal (`/share/[token]`):
 * - registers `onSharePaymentRequested` so the portal Pay button redirects
 *   to a Stripe-hosted Checkout Session (Tallyhand never sees card data);
 * - declares a settings section (master switch, statement descriptor).
 *
 * Webhook handling lives in `src/app/api/v1/stripe/webhook/route.ts`, which
 * verifies the Stripe signature, marks the invoice paid, and emits
 * `onInvoicePaid` + `onPaymentReceived`.
 *
 * Configuration is environment-only for secrets:
 * - `STRIPE_SECRET_KEY` (required) — test-mode secret key (sk_test_…);
 *   without it the plugin stays inert and the portal shows
 *   "payments not configured". Live keys (sk_live_…) work but are loudly
 *   warned about — test mode is the documented default.
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
import { getServerProvider } from "@/server/provider";
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
    if (!getStripeConfig()) {
      // eslint-disable-next-line no-console
      console.warn(
        "[stripe-payments] STRIPE_SECRET_KEY is not set — portal payments stay disabled.",
      );
      return;
    }

    onSharePaymentRequested(async (req) => {
      const provider = getServerProvider();
      const checkout = await createInvoiceCheckoutSession(
        provider,
        req.invoiceId,
        { shareToken: req.shareToken },
      );
      return { checkoutUrl: checkout.url };
    });

    ctx.settings.registerSection({
      id: "stripe-payments.settings",
      title: "Stripe payments",
      description:
        "Online payments for the client portal. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in the environment — secrets are never stored in settings.",
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
