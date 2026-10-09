/** Credential operations are server-only; browser owners may read metadata. */
import { v, ConvexError } from "convex/values";
import { ownerQuery, serverQuery, serverMutation } from "./access";
const binding = { userId: v.string(), accountId: v.string(), livemode: v.boolean() };
const owner = { userId: v.string() };
export const metadata = ownerQuery({ args: owner, handler: async (ctx, args) => {
  const row = await ctx.db.query("stripeConnections").withIndex("by_owner", q => q.eq("userId", args.userId)).unique();
  if (!row) return null;
  const { secretEnvelope: _secret, _id, _creationTime, ...meta } = row;
  return meta;
}});
export const credential = serverQuery({ args: binding, handler: async (ctx, args) => {
  const row = await ctx.db.query("stripeConnections").withIndex("by_owner", q => q.eq("userId", args.userId)).unique();
  return row && row.accountId === args.accountId && row.livemode === args.livemode ? row.secretEnvelope : null;
}});
export const ownerForAccount = serverQuery({ args: { accountId: v.string(), livemode: v.boolean() }, handler: async (ctx, args) => {
  const rows = await ctx.db.query("stripeConnections").withIndex("by_account_mode", q => q.eq("accountId", args.accountId).eq("livemode", args.livemode)).take(2);
  return rows.length === 1 ? rows[0].userId : null;
}});
export const save = serverMutation({ args: { ...binding, chargesEnabled: v.union(v.boolean(), v.null()), payoutsEnabled: v.union(v.boolean(), v.null()), secretEnvelope: v.string() }, handler: async (ctx, args) => {
  if (!args.userId || !args.accountId || !args.secretEnvelope) throw new ConvexError({ code: "BAD_REQUEST" });
  const existing = await ctx.db.query("stripeConnections").withIndex("by_owner", q => q.eq("userId", args.userId)).unique();
  const accounts = await ctx.db.query("stripeConnections").withIndex("by_account_mode", q => q.eq("accountId", args.accountId).eq("livemode", args.livemode)).collect();
  if (accounts.some(row => row.userId !== args.userId)) throw new ConvexError({ code: "CONFLICT" });
  const now = Date.now(), data = { ...args, createdAt: existing?.createdAt ?? now, updatedAt: now };
  if (existing) await ctx.db.replace(existing._id, data); else await ctx.db.insert("stripeConnections", data);
  const { secretEnvelope: _secret, ...meta } = data;
  return meta;
}});
export const remove = serverMutation({ args: owner, handler: async (ctx, args) => {
  const row = await ctx.db.query("stripeConnections").withIndex("by_owner", q => q.eq("userId", args.userId)).unique();
  if (row) await ctx.db.delete(row._id);
}});
