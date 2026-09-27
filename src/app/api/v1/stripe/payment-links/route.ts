import { z } from "zod";
import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import {
  createInvoiceCheckoutSession,
  getStripeConfig,
} from "@/server/stripe-service";
import { StripeError } from "@/plugins/stripe/stripe-client";

export const runtime = "nodejs";

const Body = z
  .object({
    invoiceId: z.string().min(1, "invoiceId is required"),
    cancelUrl: z.string().url().optional(),
  })
  .strict();

/**
 * Create a Stripe Checkout payment link for a sent invoice.
 *
 * Body: `{ invoiceId, cancelUrl? }`. Returns `{ data: { sessionId, url,
 * invoiceId, invoiceNumber, amountCents, currency } }` — redirect the payer
 * to `url`. Idempotent via `Idempotency-Key`.
 */
export async function POST(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  if (!getStripeConfig()) {
    return badRequest(
      "Stripe is not configured — set STRIPE_SECRET_KEY in the environment",
    );
  }
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid payment link request", parsed.error.issues);
    }
    try {
      const checkout = await createInvoiceCheckoutSession(
        getServerProvider(),
        parsed.data.invoiceId,
        { cancelUrl: parsed.data.cancelUrl },
      );
      return created(checkout);
    } catch (err) {
      if (err instanceof StripeError) {
        return badRequest(`Stripe error: ${err.message}`, {
          code: err.stripeCode ?? "stripe_error",
          httpStatus: err.status,
        });
      }
      const status =
        err instanceof Error &&
        typeof (err as unknown as { status?: number }).status === "number"
          ? (err as unknown as { status: number }).status
          : 400;
      const code =
        status === 404 ? "not_found" : status === 409 ? "conflict" : "bad_request";
      const message =
        err instanceof Error ? err.message : "Payment link creation failed";
      return new Response(JSON.stringify({ error: { code, message } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
  });
}
