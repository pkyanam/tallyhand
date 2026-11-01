/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const create = makeFunctionReference<"mutation">("tally:shareCreate");
const revoke = makeFunctionReference<"mutation">("tally:shareRevoke");
const list = makeFunctionReference<"query">("tally:shareList");

describe("Convex cloud invoice link revocation", () => {
  it("revokes an owner's link using the actual share-link indexes", async () => {
    const db = convexTest(schema, modules);
    const owner = db.withIdentity({ subject: "owner" });
    await owner.mutation(create, { userId: "owner", id: "share", type: "invoice", target: { invoiceId: "invoice" }, expiresAt: Date.now() + 60000 });
    await expect(owner.mutation(revoke, { userId: "owner", id: "share" })).resolves.toEqual({ revoked: true });
    expect(await owner.query(list, { userId: "owner" })).toEqual([expect.objectContaining({ id: "share", revokedAt: expect.any(Number) })]);
  });
  it("does not revoke a different owner's link", async () => {
    const db = convexTest(schema, modules);
    const owner = db.withIdentity({ subject: "owner" });
    await owner.mutation(create, { userId: "owner", id: "share", type: "invoice", target: { invoiceId: "invoice" }, expiresAt: Date.now() + 60000 });
    const other = db.withIdentity({ subject: "other" });
    await expect(other.mutation(revoke, { userId: "other", id: "share" })).rejects.toThrow();
    expect((await owner.query(list, { userId: "owner" }))[0].revokedAt).toBeUndefined();
  });
});
