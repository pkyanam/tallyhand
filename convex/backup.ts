import { v, ConvexError } from "convex/values";
import { ownerQuery, ownerMutation } from "./access";
import { DEFAULT_SETTINGS } from "../src/core/entities";
import { normalizeSettings } from "../src/core/settings";
import { validateCloudBackup, MAX_BACKUP_BYTES } from "../src/core/cloud-backup";
import { TALLYHAND_BUNDLE_FORMAT } from "../src/core/backup";
import { normalize as normalizeExtension } from "./extensions";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_STORED_DOCUMENTS = 4000;
const tables = ["clients", "projects", "tasks", "expenses", "invoices", "recurringSchedules", "retainers", "settings", "shareLinks", "timesheetApprovals"] as const;
const extensions = { mileageEntries: "mileage", contracts: "contract", taxPayments: "taxPayment", rateCards: "rateCard" } as const;
function clean(row: Record<string, unknown>) {
  const { _id, _creationTime, userId, ...data } = row;
  return data;
}
async function snapshot(ctx: QueryCtx | MutationCtx, userId: string) {
  const docs = [];
  const bundle: Record<string, unknown> = { format: TALLYHAND_BUNDLE_FORMAT, exportedAt: new Date().toISOString() };
  for (const table of tables) {
    const rows = await ctx.db.query(table).withIndex("by_user", q => q.eq("userId", userId)).take(MAX_STORED_DOCUMENTS + 1);
    docs.push(...rows);
    if (table === "settings") bundle.settings = normalizeSettings((rows[0] as { data?: typeof DEFAULT_SETTINGS })?.data ?? DEFAULT_SETTINGS);
    else if (table !== "shareLinks" && table !== "timesheetApprovals") bundle[table] = rows.map(clean);
  }
  for (const [key, kind] of Object.entries(extensions)) {
    const rows = await ctx.db.query("extensionEntities").withIndex("by_owner_kind", q => q.eq("userId", userId).eq("kind", kind)).take(MAX_STORED_DOCUMENTS + 1);
    docs.push(...rows); bundle[key] = rows.map(row => row.data);
  }
  if (docs.length > MAX_STORED_DOCUMENTS) throw new ConvexError({ code: "BACKUP_TOO_LARGE", message: "Workspace exceeds the atomic backup limit" });
  if (new TextEncoder().encode(JSON.stringify(bundle)).length > MAX_BACKUP_BYTES) throw new ConvexError({ code: "BACKUP_TOO_LARGE", message: "Backup exceeds the atomic backup limit" });
  const version = await ctx.db.query("workspaceRevisions").withIndex("by_user", q => q.eq("userId", userId)).unique();
  return { bundle, docs, revision: version?.revision ?? 0 };
}
export const read = ownerQuery({ args: { userId: v.string() }, handler: async (ctx, args) => {
  const { bundle, revision } = await snapshot(ctx, args.userId);
  return { bundle, revision };
} });
export const replace = ownerMutation({ args: {
  userId: v.string(), expectedRevision: v.number(), action: v.union(v.literal("import"), v.literal("reset")),
  confirmation: v.string(), bundle: v.optional(v.any()),
}, handler: async (ctx, args) => {
  if (args.confirmation !== (args.action === "import" ? "REPLACE CLOUD DATA" : "RESET CLOUD DATA")) throw new ConvexError({ code: "BAD_REQUEST", message: "Confirmation required" });
  let bundle;
  try { bundle = args.action === "import" ? validateCloudBackup(args.bundle) : null; }
  catch { throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid backup" }); }
  const current = await snapshot(ctx, args.userId);
  if (current.revision !== args.expectedRevision) throw new ConvexError({ code: "BACKUP_CHANGED", message: "Workspace changed since backup" });
  // This entire operation is one transaction. A failed insert rolls back all deletes.
  for (const doc of current.docs) await ctx.db.delete(doc._id);
  if (bundle) {
    for (const table of tables) {
      if (table === "settings" || table === "shareLinks" || table === "timesheetApprovals") continue;
      for (const row of bundle[table] ?? []) {
        const { publicToken, ...data } = clean(row as unknown as Record<string, unknown>);
        // Convex's schema rejects unsupported fields, rather than silently dropping data.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.insert(table, { ...data, userId: args.userId } as any);
      }
    }
    for (const [key, kind] of Object.entries(extensions)) {
      for (const row of bundle[key as keyof typeof extensions] ?? []) {
        const data = normalizeExtension(kind, row, row.id, row.createdAt);
        await ctx.db.insert("extensionEntities", { userId: args.userId, id: row.id, kind, data, updatedAt: data.updatedAt as number });
      }
    }
  }
  await ctx.db.insert("settings", { userId: args.userId, data: normalizeSettings(bundle?.settings ?? DEFAULT_SETTINGS) });
  // Account, sign-in and personal API tokens survive. Old public links and approvals do not.
  return { action: args.action, complete: true };
} });
