import { tryResolveSessionUserId } from "@/lib/auth/session";
import { getStripeConnectionMeta } from "@/lib/stripe-connect/store";
import { parseStorage } from "@/lib/mode";
export const runtime = "nodejs";
export async function GET() {
  try {
    const userId = await tryResolveSessionUserId();
    if (!userId) return Response.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });
    // An optional capability must not crash the entire settings experience.
    if (parseStorage() === "convex") return Response.json({ data: {
      connected: false, supported: false,
      message: "Stripe Connect is not available with Convex storage yet.",
    } });
    const c = await getStripeConnectionMeta(userId);
    return Response.json({ data: c ? {
      supported: true, connected: true, accountId: c.accountId,
      livemode: c.livemode, chargesEnabled: c.chargesEnabled, payoutsEnabled: c.payoutsEnabled,
    } : { supported: true, connected: false } });
  } catch {
    return Response.json({ error: { code: "unavailable", message: "Stripe connection status is temporarily unavailable" } }, { status: 503 });
  }
}
