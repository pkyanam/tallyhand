import { v } from "convex/values";
import { serverQuery, serverMutation } from "./access";
export const create = serverMutation({
  args: { userId: v.string(), grant: v.any() },
  handler: async (ctx, args) => {
    const g = args.grant;
    if (
      g.userId !== args.userId ||
      g.workspaceId !== args.userId ||
      g.revokedAt !== null
    )
      throw new Error("Invalid grant owner");
    await ctx.db.insert("financialGrants", {
      id: g.id,
      userId: g.userId,
      workspaceId: g.workspaceId,
      data: g,
      revokedAt: null,
    });
    return g;
  },
});
export const get = serverQuery({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const g = await ctx.db
      .query("financialGrants")
      .withIndex("by_grant_id", (q) => q.eq("id", args.id))
      .unique();
    return g?.userId === args.userId
      ? { ...g.data, revokedAt: g.revokedAt }
      : null;
  },
});
export const list = serverQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("financialGrants")
        .withIndex("by_owner", (q) => q.eq("userId", args.userId))
        .take(101)
    ).map((g) => ({ ...g.data, revokedAt: g.revokedAt })),
});
export const revoke = serverMutation({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const g = await ctx.db
      .query("financialGrants")
      .withIndex("by_grant_id", (q) => q.eq("id", args.id))
      .unique();
    if (!g || g.userId !== args.userId) return false;
    await ctx.db.patch(g._id, { revokedAt: Date.now() });
    return true;
  },
});
