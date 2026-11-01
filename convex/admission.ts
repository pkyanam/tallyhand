/** Direct Convex calls use native verified Clerk identities and trusted short-lived decisions. */
import { actionGeneric, internalMutationGeneric, makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { GenericQueryCtx, GenericMutationCtx, DataModelFromSchemaDefinition, UserIdentity, GenericActionCtx } from "convex/server";
import type schema from "./schema";
type Model = DataModelFromSchemaDefinition<typeof schema>;
type Ctx = GenericQueryCtx<Model> | GenericMutationCtx<Model>;
const TTL = 60_000;
function config() {
  const merchantId = process.env.AGENTSUB_MERCHANT_ID, offerId = process.env.AGENTSUB_OFFER_ID, key = process.env.AGENTSUB_MERCHANT_KEY;
  if (!merchantId && !offerId && !key) return null;
  if (!merchantId || !offerId || !key) throw new ConvexError("Admission configuration unavailable");
  return { merchantId, offerId, key };
}
export async function requireIdentityAdmission(ctx: Ctx, identity: UserIdentity) {
  const settings = config(); if (!settings) return;
  if (!identity.subject.startsWith("user_") || identity.act) throw new ConvexError("Account admission required");
  const record = await ctx.db.query("applicationAdmissions").withIndex("by_subject", q => q.eq("clerkSubject", identity.subject)).unique();
  if (!record?.allowed || record.expiresAt <= Date.now() || record.merchantId !== settings.merchantId || record.offerId !== settings.offerId) throw new ConvexError("Refresh application admission before continuing");
}
export const store = internalMutationGeneric({
  args: { clerkSubject: v.string(), kind: v.union(v.literal("agent"), v.literal("human")), allowed: v.boolean(), merchantId: v.string(), offerId: v.string(), expiresAt: v.number(), checkedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("applicationAdmissions").withIndex("by_subject", q => q.eq("clerkSubject", args.clerkSubject)).unique();
    if (existing && existing.checkedAt > args.checkedAt) return existing.allowed;
    const previousAgent = await ctx.db.query("applicationAdmissions").withIndex("by_subject", q => q.eq("clerkSubject", args.clerkSubject)).filter(q => q.eq(q.field("kind"), "agent")).first();
    const row = { ...args, allowed: args.allowed && !(previousAgent && args.kind === "human"), kind: previousAgent ? "agent" as const : args.kind, expiresAt: Math.min(args.expiresAt, args.checkedAt + TTL) };
    if (existing) await ctx.db.replace(existing._id, row); else await ctx.db.insert("applicationAdmissions", row);
    if (row.allowed) await ctx.scheduler.runAt(row.expiresAt, makeFunctionReference<"mutation">("admission:expire"), {
      clerkSubject: row.clerkSubject, checkedAt: row.checkedAt, expiresAt: row.expiresAt,
    });
    return row.allowed;
  },
});
/** Changing the record invalidates subscribed query results when a grant expires. */
export const expire = internalMutationGeneric({
  args: { clerkSubject: v.string(), checkedAt: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("applicationAdmissions").withIndex("by_subject", q => q.eq("clerkSubject", args.clerkSubject)).unique();
    if (row && row.checkedAt === args.checkedAt && row.expiresAt === args.expiresAt && row.expiresAt <= Date.now()) {
      await ctx.db.patch(row._id, { allowed: false });
    }
  },
});
class ClearanceDenied extends Error {}
async function request(url: string, key: string, body?: unknown) {
  const res = await fetch(url, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text(); if (text.length > 256000) throw new Error("Invalid response");
  const data = JSON.parse(text);
  if (!res.ok) {
    if (url === "https://api.agentsub.dev/v1/access/merchant-check" && ((res.status === 404 && data?.code === "NOT_FOUND") || (res.status === 403 && data?.code === "CAP_EXCEEDED"))) throw new ClearanceDenied();
    throw new Error("Verification unavailable");
  }
  return data;
}
async function check(ctx: GenericActionCtx<Model>, identity: UserIdentity): Promise<{ allowed: boolean; expiresAt: number; reason?: "clearance_denied" }> {
  const settings = config(); if (!settings) return { allowed: true, expiresAt: Date.now() + TTL };
  const checkedAt = Date.now();
  if (!identity.subject.startsWith("user_") || identity.act) throw new ConvexError("Account binding required");
  const save = (allowed: boolean, kind: "agent" | "human", expiresAt: number) => ctx.runMutation(makeFunctionReference<"mutation">("admission:store"), { clerkSubject: identity.subject, kind, allowed, merchantId: settings.merchantId, offerId: settings.offerId, expiresAt, checkedAt });
  let kind: "agent" | "human" = "human";
  try {
    const clerkKey = process.env.CLERK_SECRET_KEY; if (!clerkKey) throw new Error();
    const user = await request(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, clerkKey);
    if (user.id !== identity.subject || !Array.isArray(user.external_accounts)) throw new Error();
    const accounts = user.external_accounts.filter((a: { provider?: string }) => a.provider === "oauth_agentid");
    if (accounts.length) kind = "agent";
    if (accounts.length > 1 || (accounts.length === 1 && (typeof accounts[0].provider_user_id !== "string" || !accounts[0].provider_user_id.trim() || accounts[0].verification?.status !== "verified"))) throw new Error();
    let allowed = true;
    if (accounts.length) {
      const agentIdentity = { issuer: "https://auth.agentid.com", subject: accounts[0].provider_user_id };
      const grant = await request("https://api.agentsub.dev/v1/access/merchant-check", settings.key, { offerId: settings.offerId, agentIdentity });
      if (grant?.merchantId !== settings.merchantId || grant?.offerId !== settings.offerId || grant?.agentIdentity?.issuer !== agentIdentity.issuer || grant?.agentIdentity?.subject !== agentIdentity.subject || typeof grant?.allowed !== "boolean") throw new Error();
      allowed = grant.allowed === true && grant.paymentRequired === false && grant.priceUc === "0";
    }
    const expiresAt = checkedAt + TTL;
    allowed = await save(allowed, accounts.length ? "agent" : "human", expiresAt) as boolean;
    // The database boundary also prevents a previously verified agent from downgrading to human.
    return { allowed, expiresAt, ...(!allowed ? { reason: "clearance_denied" as const } : {}) };
  } catch (error) {
    await save(false, kind, checkedAt);
    if (error instanceof ClearanceDenied) return { allowed: false, expiresAt: checkedAt, reason: "clearance_denied" };
    throw new ConvexError("Application admission could not be verified");
  }
}
export const refresh = actionGeneric({ args: {}, handler: async ctx => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Sign in required");
  return check(ctx, identity);
} });
/** Native Next.js bridge has already verified the resource-bound credential. Caller secrets never reach browsers. */
export const refreshBridge = actionGeneric({ args: { userId: v.string(), serverSecret: v.string() }, handler: async (ctx, args) => {
  const expected = process.env.TALLY_CONVEX_SERVER_SECRET;
  if (!expected || expected.length < 32 || expected.length !== args.serverSecret.length) throw new ConvexError("Server authorization required");
  let difference = 0; for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ args.serverSecret.charCodeAt(i);
  if (difference || !args.userId.startsWith("user_")) throw new ConvexError("Server authorization required");
  return check(ctx, { subject: args.userId } as UserIdentity);
} });
