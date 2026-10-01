import { v } from "convex/values";
import { ownerQuery } from "./access";

/** Cheap native subscription shared by all app queries, scoped to the owner. */
export const revision = ownerQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db.query("workspaceRevisions")
      .withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return row?.revision ?? 0;
  },
});
