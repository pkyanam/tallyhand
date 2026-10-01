import { v, ConvexError } from "convex/values";
import { ownerMutation, ownerQuery } from "./access";
import { mileageRateForDate } from "../src/core/mileage";
import { mileageCreateSchema, contractCreateSchema, taxPaymentCreateSchema, rateCardCreateSchema } from "../src/server/validation";

const kindValidator = v.union(v.literal("mileage"), v.literal("contract"), v.literal("taxPayment"), v.literal("rateCard"));
type Kind = "mileage" | "contract" | "taxPayment" | "rateCard";
const schemas = { mileage: mileageCreateSchema, contract: contractCreateSchema, taxPayment: taxPaymentCreateSchema, rateCard: rateCardCreateSchema };
const args = { userId: v.string(), kind: kindValidator };
export function normalize(kind: Kind, input: unknown, id: string, originalCreatedAt?: number): Record<string, unknown> {
  const validation = schemas[kind].safeParse(input);
  if (!validation.success) throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid record data" });
  const parsed = validation.data as Record<string, unknown>;
  if (kind === "contract" && typeof parsed.endDate === "number" && parsed.endDate < (parsed.startDate as number)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Contract end date precedes start date" });
  }
  if (kind === "rateCard" && typeof parsed.effectiveTo === "number" && parsed.effectiveTo < (parsed.effectiveFrom as number)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Rate card end date precedes start date" });
  }
  const now = Date.now();
  const result = { ...parsed, id, createdAt: originalCreatedAt ?? parsed.createdAt ?? now, updatedAt: parsed.updatedAt ?? now };
  if (kind === "mileage") return { isBilled: false, ...result, rate: parsed.rate ?? mileageRateForDate(parsed.date as number) };
  if (kind === "contract") return { renewalNoticeDays: 30, archived: false, ...result };
  if (kind === "rateCard") return { archived: false, lines: [], ...result };
  return result;
}

export const list = ownerQuery({ args, handler: async (ctx, input) => {
  const rows = await ctx.db.query("extensionEntities").withIndex("by_owner_kind", (q) => q.eq("userId", input.userId).eq("kind", input.kind)).collect();
  return rows.map((row) => row.data).sort((a, b) => (b.date ?? b.updatedAt) - (a.date ?? a.updatedAt));
} });
export const get = ownerQuery({ args: { ...args, id: v.string() }, handler: async (ctx, input) => {
  const row = await ctx.db.query("extensionEntities").withIndex("by_owner_kind_id", (q) => q.eq("userId", input.userId).eq("kind", input.kind).eq("id", input.id)).unique();
  return row?.data ?? null;
} });
export const create = ownerMutation({ args: { ...args, id: v.string(), data: v.any() }, handler: async (ctx, input) => {
  const existing = await ctx.db.query("extensionEntities").withIndex("by_owner_kind_id", (q) => q.eq("userId", input.userId).eq("kind", input.kind).eq("id", input.id)).unique();
  if (existing) throw new ConvexError({ code: "CONFLICT", message: "Record already exists" });
  const data = normalize(input.kind, input.data, input.id);
  await ctx.db.insert("extensionEntities", { userId: input.userId, kind: input.kind, id: input.id, data, updatedAt: data.updatedAt as number });
  return data;
} });
export const update = ownerMutation({ args: { ...args, id: v.string(), patch: v.any() }, handler: async (ctx, input) => {
  const row = await ctx.db.query("extensionEntities").withIndex("by_owner_kind_id", (q) => q.eq("userId", input.userId).eq("kind", input.kind).eq("id", input.id)).unique();
  if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "Record not found" });
  const data = normalize(input.kind, { ...row.data, ...input.patch, id: input.id, createdAt: row.data.createdAt, updatedAt: Date.now() }, input.id, row.data.createdAt);
  await ctx.db.patch(row._id, { data, updatedAt: data.updatedAt as number });
  return data;
} });
export const remove = ownerMutation({ args: { ...args, id: v.string() }, handler: async (ctx, input) => {
  const row = await ctx.db.query("extensionEntities").withIndex("by_owner_kind_id", (q) => q.eq("userId", input.userId).eq("kind", input.kind).eq("id", input.id)).unique();
  if (row) await ctx.db.delete(row._id);
} });
