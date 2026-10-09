import { z } from "zod";
import { getServerProvider } from "@/server/provider";
import { badRequest, created } from "@/server/http";
import { createInvoiceCheckoutSession } from "@/server/stripe-service";
import { StripeError } from "@/plugins/stripe/stripe-client";
import { resolveFinancialRequestAuthority } from "@/server/financial-authority";
import { CryptoConfigError } from "@/lib/crypto/connect-crypto";

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
  const operationId = req.headers.get("Idempotency-Key");
  if (!operationId || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    return badRequest(
      "A stable Idempotency-Key (1–128 letters, digits, underscores or hyphens) is required",
    );
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid payment link request", parsed.error.issues);
  }
  try {
    const { userId, authority } = await resolveFinancialRequestAuthority(req);
    const checkout = await createInvoiceCheckoutSession(
      getServerProvider(),
      parsed.data.invoiceId,
      { cancelUrl: parsed.data.cancelUrl, userId, authority, operationId },
    );
    return created(checkout);
  } catch (err) {
    if (err instanceof CryptoConfigError)
      return Response.json(
        {
          error: {
            code: "stripe_unavailable",
            message:
              "Stripe Connect is unavailable: encryption is not configured",
          },
        },
        { status: 503 },
      );
    if (err instanceof StripeError) {
      return Response.json(
        {
          error: {
            code: err.stripeCode ?? "stripe_error",
            message: err.message,
          },
        },
        {
          status: [202, 403, 409, 503].includes(err.status) ? err.status : 502,
        },
      );
    }
    const status =
      err instanceof Error &&
      typeof (err as unknown as { status?: number }).status === "number"
        ? (err as unknown as { status: number }).status
        : 400;
    const code =
      status === 404
        ? "not_found"
        : status === 409
          ? "conflict"
          : "bad_request";
    const message =
      err instanceof Error ? err.message : "Payment link creation failed";
    return new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}
