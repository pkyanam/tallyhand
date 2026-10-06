/** Authentication belongs at the database boundary, including direct clients. */
import {
  queryGeneric, mutationGeneric,
  type DataModelFromSchemaDefinition, type GenericQueryCtx, type GenericMutationCtx,
} from "convex/server";
import { v, ConvexError, type ObjectType, type PropertyValidators } from "convex/values";
import type schema from "./schema";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type ReadCtx = GenericQueryCtx<DataModel>;
type WriteCtx = GenericMutationCtx<DataModel>;

export function hasServerAccess(value: unknown): boolean {
  const expected = process.env.TALLY_CONVEX_SERVER_SECRET;
  if (!expected || expected.length < 32 || typeof value !== "string" || value.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ value.charCodeAt(i);
  return difference === 0;
}

export async function requireOwner(
  ctx: ReadCtx,
  args: { userId?: unknown; serverSecret?: unknown },
  write = false,
) {
  // The server bridge has already authenticated the request and enforced
  // app roles. Direct browser calls must carry a verified Clerk JWT.
  if (hasServerAccess(args.serverSecret)) {
    if (typeof args.userId !== "string" || !args.userId) throw new ConvexError("Owner required");
    return args.userId;
  }
  const identity = await ctx.auth.getUserIdentity();
  let userId: string | undefined;
  if (identity) {
    userId = identity.subject;
    // New Clerk accounts have no public role metadata yet. Match the app's
    // member default only for absent/null claims; explicit unknown roles deny.
    const role = identity.role ?? "member";
    if (write && role !== "member" && role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Viewers have read-only access" });
    }
  }
  if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
  if (args.userId !== undefined && args.userId !== userId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner mismatch" });
  }
  return userId;
}

export function ownerQuery<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: ReadCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return queryGeneric({
    args: { ...definition.args, serverSecret: v.optional(v.string()) },
    handler: async (ctx, args) => {
      await requireOwner(ctx, args);
      const { serverSecret: _credential, ...payload } = args;
      return definition.handler(ctx, payload as ObjectType<A>);
    },
  });
}

export function ownerMutation<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: WriteCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return mutationGeneric({
    args: { ...definition.args, serverSecret: v.optional(v.string()) },
    handler: async (ctx, args) => {
      const userId = await requireOwner(ctx, args, true);
      const { serverSecret: _credential, ...payload } = args;
      const result = await definition.handler(ctx, payload as ObjectType<A>);
      const revision = await ctx.db.query("workspaceRevisions")
        .withIndex("by_user", (q) => q.eq("userId", userId)).unique();
      if (revision) await ctx.db.patch(revision._id, { revision: revision.revision + 1 });
      else await ctx.db.insert("workspaceRevisions", { userId, revision: 1 });
      return result;
    },
  });
}

/** Unscoped lookups are exclusively server-side, after capability validation. */
export function serverQuery<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: ReadCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return queryGeneric({
    args: { ...definition.args, serverSecret: v.string() },
    handler: async (ctx, args) => {
      if (!hasServerAccess(args.serverSecret)) throw new ConvexError("Server authorization required");
      const { serverSecret: _credential, ...payload } = args;
      return definition.handler(ctx, payload as ObjectType<A>);
    },
  });
}

export function serverMutation<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: WriteCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return mutationGeneric({
    args: { ...definition.args, serverSecret: v.string() },
    handler: async (ctx, args) => {
      if (!hasServerAccess(args.serverSecret)) throw new ConvexError("Server authorization required");
      const { serverSecret: _credential, ...payload } = args;
      return definition.handler(ctx, payload as ObjectType<A>);
    },
  });
}
