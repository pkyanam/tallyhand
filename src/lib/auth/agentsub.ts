/** Server-only admission. Native Clerk identity and workspace ownership remain unchanged. */
import { parseStorage } from "@/lib/mode";
import { createClerkClient } from "@clerk/backend";
import { memoRequestAuth } from "./request-cache";

const ISSUER = "https://auth.agentid.com";
const ENDPOINT = "https://api.agentsub.dev/v1/access/merchant-check";
export class AgentSubAdmissionError extends Error {
  constructor(public readonly reason: "clearance_denied" | "verification_unavailable" = "verification_unavailable") { super("Agent subscription access could not be verified"); }
}
/** Policy denials do not imply an invalid OAuth token or require reconnecting. */
export function agentSubDeniedResponse(error: unknown): Response | null {
  if (!(error instanceof AgentSubAdmissionError) || error.reason !== "clearance_denied") return null;
  return Response.json({ error: { code: "clearance_denied", message: "Agent subscription clearance is denied. Check access with the agent owner or switch accounts." } },
    { status: 403, headers: { "Cache-Control": "no-store" } });
}
export function agentsubConfigured(): boolean {
  return !!(process.env.AGENTSUB_MERCHANT_ID || process.env.AGENTSUB_OFFER_ID || process.env.AGENTSUB_MERCHANT_KEY);
}
/** Use Clerk's authenticated account linkage, never the Clerk user id as an upstream subject. */
export async function requireAgentSubAdmission(userId: string): Promise<void> {
  if (!agentsubConfigured()) return;
  return memoRequestAuth(`agentsub:${userId}`, async () => {
    try {
      const merchantId = process.env.AGENTSUB_MERCHANT_ID;
      const offerId = process.env.AGENTSUB_OFFER_ID;
      const key = process.env.AGENTSUB_MERCHANT_KEY;
      if (!merchantId || !offerId || !key || !process.env.CLERK_SECRET_KEY) throw new AgentSubAdmissionError();
      if (parseStorage() === "convex") {
        const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
        const serverSecret = process.env.TALLY_CONVEX_SERVER_SECRET;
        if (!url || !serverSecret || serverSecret.length < 32) throw new AgentSubAdmissionError();
        const [{ ConvexHttpClient }, { makeFunctionReference }] = await Promise.all([import("convex/browser"), import("convex/server")]);
        const result = await new ConvexHttpClient(url).action(makeFunctionReference<"action">("admission:refreshBridge"), { userId, serverSecret });
        if (result?.allowed !== true) throw new AgentSubAdmissionError(result?.reason === "clearance_denied" ? "clearance_denied" : "verification_unavailable");
        return;
      }
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
      const user = await clerk.users.getUser(userId);
      if (user.id !== userId) throw new AgentSubAdmissionError();
      const accounts = user.externalAccounts.filter(account => account.provider === "oauth_agentid");
      if (!accounts.length) return; // Existing human accounts keep their native authorization.
      if (accounts.length !== 1 || !accounts[0].providerUserId?.trim() || accounts[0].verification?.status !== "verified") throw new AgentSubAdmissionError();
      const agentIdentity = { issuer: ISSUER, subject: accounts[0].providerUserId };
      const response = await fetch(ENDPOINT, {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, agentIdentity }),
      });
      if (!response.ok) throw new AgentSubAdmissionError();
      const grant = await response.json();
      if (grant?.merchantId !== merchantId || grant?.offerId !== offerId ||
          grant?.agentIdentity?.issuer !== ISSUER || grant?.agentIdentity?.subject !== agentIdentity.subject ||
          grant?.allowed !== true || grant?.paymentRequired !== false || grant?.priceUc !== "0") throw new AgentSubAdmissionError();
    } catch (error) { if (error instanceof AgentSubAdmissionError) throw error; throw new AgentSubAdmissionError(); }
  });
}
