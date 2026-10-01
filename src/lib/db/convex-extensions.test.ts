/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const create = makeFunctionReference<"mutation">("extensions:create");
const update = makeFunctionReference<"mutation">("extensions:update");
const remove = makeFunctionReference<"mutation">("extensions:remove");
const list = makeFunctionReference<"query">("extensions:list");
const date = Date.UTC(2025, 6, 1);
const cases = [
  { kind: "mileage", data: { date, miles: 10, purpose: "Client visit" }, patch: { purpose: "Return trip" } },
  { kind: "contract", data: { clientId: "client", type: "sow", title: "Website", startDate: date }, patch: { title: "Website revision" } },
  { kind: "taxPayment", data: { taxYear: 2025, quarter: 2, date, amount: 250, jurisdiction: "federal" }, patch: { amount: 300 } },
  { kind: "rateCard", data: { clientId: "client", name: "Standard", defaultRate: 100, effectiveFrom: date }, patch: { defaultRate: 125 } },
];
describe("Convex contractor tools", () => {
  it.each([
    { kind: "contract", data: { ...cases[1].data, endDate: date - 1 } },
    { kind: "rateCard", data: { ...cases[3].data, effectiveTo: date - 1 } },
  ])("rejects a reversed date range for $kind", async ({ kind, data }) => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner", role: "member" });
    await expect(t.mutation(create, { userId: "owner", kind, id: "record", data })).rejects.toThrow();
    expect(await t.query(list, { userId: "owner", kind })).toEqual([]);
  });
  it.each(cases)("persists and edits $kind through its complete lifecycle", async ({ kind, data, patch }) => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner", role: "member" });
    const args = { userId: "owner", kind, id: "record" };
    const original = await t.mutation(create, { ...args, data });
    expect(original).toMatchObject({ ...data, id: "record" });
    const changed = await t.mutation(update, { ...args, patch });
    expect(changed).toMatchObject(patch);
    expect(changed.createdAt).toBe(original.createdAt);
    expect(await t.query(list, { userId: "owner", kind })).toHaveLength(1);
    await t.mutation(remove, args);
    expect(await t.query(list, { userId: "owner", kind })).toEqual([]);
  });
  it("seeds mileage defaults and retains the original rate on edits", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner", role: "member" });
    const args = { userId: "owner", kind: "mileage", id: "trip" };
    expect(await t.mutation(create, { ...args, data: cases[0].data })).toMatchObject({ rate: 0.7, isBilled: false });
    expect(await t.mutation(update, { ...args, patch: { date: Date.UTC(2024, 1, 1) } })).toMatchObject({ rate: 0.7 });
  });
});
