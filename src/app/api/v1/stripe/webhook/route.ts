import { getServerProvider } from "@/server/provider";
import { badRequest, ok } from "@/server/http";
import { pluginRegistry } from "@/plugins";
import { verifyWebhookSignature } from "@/plugins/stripe/stripe-client";

export const runtime = "nodejs";

/**
 * POST /api/v1/stripe/webhook — PUBLIC Stripe webhook endpoint.
 *
 * No API-token auth: Stripe authenticates via the `stripe-signature`
 * header, verified here against STRIPE_WEBHOOK_SECRET with a 5-minute
 * replay tolerance. Requires STRIPE_WEBHOOK_SECRET in the environment.
 *
 * On `checkout.session.completed` the referenced invoice is marked paid
 * and `onInvoicePaid` + `onPaymentReceived` are emitted. Already-paid
 * invoices are a no-op (Stripe retries deliveries). Unhandled event types
 * are acknowledged without action.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return badRequest(
      "Stripe webhooks are not configured — set STRIPE_WEBHOOK_SECRET",
    );
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (
    !signature ||
    !verifyWebhookSignature(rawBody, signature, webhookSecret)
  ) {
    return badRequest("Invalid webhook signature", {
      code: "invalid_signature",
    });
  }

  let event: {
    type?: string;
    account?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return badRequest("Invalid webhook payload");
  }

  if (event.type === "checkout.session.completed") {
    const session = (event.data?.object ?? {}) as {
      id?: string;
      amount_total?: number;
      currency?: string;
      payment_status?: string;
      metadata?: Record<string, string>;
    };
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId) {
      let provider = getServerProvider();
      if (event.account) {
        const { findUserIdByStripeAccount } = await import("@/lib/stripe-connect/store");
        const userId = await findUserIdByStripeAccount(event.account);
        if (!userId) return ok({ received: true });
        const { getServerProviderForUser } = await import("@/server/provider");
        provider = getServerProviderForUser(userId);
      }
      const invoice = await provider.getInvoice(invoiceId);
      if (invoice && invoice.status !== "paid") {
        // Verify the session actually represents a completed payment for
        // this invoice before marking it paid: payment_status must be
        // "paid", the currency must match the invoice currency, and the
        // charged amount must cover the invoice total. Mismatches are
        // logged and skipped.
        const expectedCents = Math.round(invoice.total * 100);
        const expectedCurrency = (
          invoice.currency ?? "usd"
        ).toLowerCase();
        const amountOk =
          typeof session.amount_total === "number" &&
          session.amount_total >= expectedCents;
        const statusOk = session.payment_status === "paid";
        const currencyOk =
          typeof session.currency === "string" &&
          session.currency.toLowerCase() === expectedCurrency;
        if (statusOk && currencyOk && amountOk) {
          await provider.markInvoicePaid(invoiceId);
          const updated = await provider.getInvoice(invoiceId);
          if (updated) {
            await pluginRegistry.emit("onInvoicePaid", updated);
            await pluginRegistry.emit("onPaymentReceived", {
              invoice: updated,
              amountCents:
                typeof session.amount_total === "number"
                  ? session.amount_total
                  : expectedCents,
              provider: "stripe",
              externalId: session.id ?? "unknown",
            });
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[stripe webhook] skipping checkout.session.completed for invoice ${invoice.invoiceNumber}: ` +
              `payment_status=${String(session.payment_status)} ` +
              `currency=${String(session.currency)} ` +
              `amount_total=${String(session.amount_total)} ` +
              `expected_cents=${expectedCents}`,
          );
        }
      }
    }
  }

  return ok({ received: true, type: event.type ?? "unknown" });
}
