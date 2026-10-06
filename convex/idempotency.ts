import { v, ConvexError } from "convex/values";
import { serverMutation, serverQuery } from "./access";

/** Atomic claim: simultaneous retries cannot both enter the handler. */
export const claim = serverMutation({
  args: { key: v.string(), fingerprint: v.string(), claimId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("requestReceipts").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (existing) {
      if (existing.fingerprint !== args.fingerprint) return { state: "conflict" as const };
      if (existing.state === "complete") return { state: "complete" as const,
        status: existing.status!, body: existing.body!, contentType: existing.contentType };
      // Never automatically steal an expired claim: its effect may have
      // committed just before the original worker lost its connection.
      return { state: "pending" as const };
    }
    await ctx.db.insert("requestReceipts", { ...args, state: "pending", createdAt: Date.now() });
    return { state: "claimed" as const };
  },
});

export const complete = serverMutation({
  args: { key: v.string(), claimId: v.string(), status: v.number(), body: v.string(), contentType: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("requestReceipts").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (!row || row.claimId !== args.claimId) throw new ConvexError("Request claim mismatch");
    if (row.state === "complete") return;
    await ctx.db.patch(row._id, { state: "complete", status: args.status, body: args.body, contentType: args.contentType });
  },
});

/** Metadata only: response payloads and claim credentials never leave this query. */
export const status = serverQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db.query("requestReceipts").withIndex("by_key", (q) => q.eq("key", key)).unique();
    return row ? { state: row.state, status: row.status ?? null, createdAt: row.createdAt } : null;
  },
});
