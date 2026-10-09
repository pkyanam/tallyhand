import { v } from "convex/values";
import { serverQuery, serverMutation } from "./access";
import type { FinancialScope } from "../src/core/financial/types";
export const discover = serverQuery({
  args: { limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)
      throw new Error("Discovery limit invalid");
    const page = await ctx.db
      .query("financialRecords")
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });
    const seen = new Set<string>();
    const items: FinancialScope[] = [];
    for (const row of page.page) {
      if (!["attempt", "payment", "event"].includes(row.kind)) continue;
      const scope = row.data.scope as FinancialScope | undefined;
      if (!scope || scope.provider !== "stripe" || seen.has(row.scopeKey))
        continue;
      seen.add(row.scopeKey);
      items.push(scope);
    }
    return {
      items,
      ...(!page.isDone ? { nextCursor: page.continueCursor } : {}),
    };
  },
});
export const claim = serverMutation({
  args: {
    id: v.string(),
    lease: v.object({ token: v.string(), expiresAt: v.number() }),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("financialMaintenance")
      .withIndex("by_job", (q) => q.eq("id", args.id))
      .unique();
    if (row?.lease && row.lease.expiresAt > args.now) return null;
    if (args.lease.expiresAt <= args.now)
      throw new Error("Invalid recovery lease");
    if (row) await ctx.db.patch(row._id, { lease: args.lease });
    else
      await ctx.db.insert("financialMaintenance", {
        id: args.id,
        progress: {},
        lease: args.lease,
      });
    return row?.progress ?? {};
  },
});
export const finish = serverMutation({
  args: {
    id: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    progress: v.any(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("financialMaintenance")
      .withIndex("by_job", (q) => q.eq("id", args.id))
      .unique();
    if (
      !row ||
      row.lease?.token !== args.leaseToken ||
      row.lease.expiresAt <= args.now
    )
      throw new Error("Recovery lease stale");
    if (Object.keys(args.progress.scopes ?? {}).length > 100)
      throw new Error("Recovery checkpoint exceeds bound");
    await ctx.db.patch(row._id, { progress: args.progress, lease: undefined });
  },
});
export const scopeProgress = serverQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    if (!/^scope:[a-f0-9]{64}$/.test(args.id))
      throw new Error("Recovery scope key invalid");
    return (
      (
        await ctx.db
          .query("financialMaintenance")
          .withIndex("by_job", (q) => q.eq("id", args.id))
          .unique()
      )?.progress ?? null
    );
  },
});
export const saveScopeProgress = serverMutation({
  args: {
    id: v.string(),
    runId: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    progress: v.any(),
  },
  handler: async (ctx, args) => {
    if (!/^scope:[a-f0-9]{64}$/.test(args.id))
      throw new Error("Recovery scope key invalid");
    const run = await ctx.db
      .query("financialMaintenance")
      .withIndex("by_job", (q) => q.eq("id", args.runId))
      .unique();
    if (
      !run ||
      run.lease?.token !== args.leaseToken ||
      run.lease.expiresAt <= args.now
    )
      throw new Error("Recovery lease stale");
    const row = await ctx.db
      .query("financialMaintenance")
      .withIndex("by_job", (q) => q.eq("id", args.id))
      .unique();
    if (args.progress === null) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    if (row) await ctx.db.patch(row._id, { progress: args.progress });
    else
      await ctx.db.insert("financialMaintenance", {
        id: args.id,
        progress: args.progress,
      });
  },
});
