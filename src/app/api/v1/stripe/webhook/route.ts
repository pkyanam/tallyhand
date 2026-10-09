import { badRequest, ok } from "@/server/http";
import { verifyWebhookSignature } from "@/plugins/stripe/stripe-client";
import { getFinancialStore } from "@/server/financial-store";
import {
  receiveStripeEvent,
  processFinancialEvent,
  type StripeEvent,
} from "@/server/financial-events";
import { isHosted } from "@/lib/mode";
import {
  getConnectAccount,
  resolveCheckoutStripeKey,
} from "@/server/stripe-connect";
import { findUserIdByStripeAccount } from "@/lib/stripe-connect/store";
import { drainFinancialNotifications } from "@/server/financial-notifications";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return new Response(
      JSON.stringify({ error: "Stripe webhook unavailable" }),
      { status: 503 },
    );
  const raw = await req.text(),
    signature = req.headers.get("stripe-signature");
  if (!signature || !verifyWebhookSignature(raw, signature, secret))
    return badRequest("Invalid webhook signature");
  let event: StripeEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return badRequest("Invalid webhook payload");
  }
  if (
    !event.id ||
    !event.type ||
    typeof event.livemode !== "boolean" ||
    !event.data?.object
  )
    return badRequest("Invalid webhook identity");
  try {
    let accountId = event.account,
      userId: string | null = null;
    if (accountId)
      userId = await findUserIdByStripeAccount(accountId, event.livemode);
    else if (!isHosted()) {
      // Self-hosted workspace identity is explicit, never inferred from metadata.
      userId = process.env.TALLY_FINANCIAL_USER_ID ?? "local";
      const resolved = await resolveCheckoutStripeKey(userId);
      if (
        resolved.source !== "platform" ||
        resolved.mode !== (event.livemode ? "live" : "test")
      )
        return badRequest("Webhook account mismatch");
      accountId = (await getConnectAccount(resolved.secretKey)).id;
    }
    if (!userId || !accountId)
      return new Response(
        JSON.stringify({ error: "Webhook account unresolved" }),
        { status: 503 },
      );
    const scope = {
      userId,
      workspaceId: userId,
      provider: "stripe" as const,
      accountId,
      mode: event.livemode ? ("live" as const) : ("test" as const),
    };
    const store = await getFinancialStore(userId);
    const received = await receiveStripeEvent(store, scope, event);
    // Receipt is committed before acknowledgement. Processing failures remain retryable.
    await processFinancialEvent(store, received.event);
    await drainFinancialNotifications(
      store,
      { userId, workspaceId: userId },
      Date.now() + 3000,
    );
    return ok({ received: true, type: event.type });
  } catch {
    return new Response(
      JSON.stringify({ error: "Financial event persistence unavailable" }),
      { status: 503 },
    );
  }
}
