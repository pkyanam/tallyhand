/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../convex/schema";
import { api } from "../../../convex/_generated/api";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");

describe("direct Clerk Convex role defaults", () => {
  it.each([undefined, null])("lets a new user with role %s write their own workspace", async (role) => {
    const base = convexTest(schema, modules);
    const identity = role === undefined ? { subject: "new-owner" } : { subject: "new-owner", role };
    const owner = base.withIdentity(identity);
    await owner.mutation(api.tally.clientsCreate, { userId: "new-owner", id: "client", name: "First client" });
    expect(await owner.query(api.tally.clientsGet, { userId: "new-owner", id: "client" })).toMatchObject({ name: "First client" });
    expect(await owner.query(api.workspace.revision, { userId: "new-owner" })).toBe(1);
    await expect(owner.mutation(api.tally.clientsCreate, { userId: "other-owner", id: "injected", name: "Invalid" })).rejects.toThrow("Owner mismatch");
    await expect(owner.query(api.tally.clientsList, { userId: "other-owner" })).rejects.toThrow("Owner mismatch");
    const other = base.withIdentity({ subject: "other-owner" });
    expect(await other.query(api.tally.clientsList, { userId: "other-owner" })).toEqual([]);
    expect(await other.query(api.workspace.revision, { userId: "other-owner" })).toBe(0);
  });

  it.each(["viewer", "unknown-role", "", false, 0])("rejects explicit role %s writes without changing data", async (role) => {
    const base = convexTest(schema, modules);
    const member = base.withIdentity({ subject: "owner", role: "member" });
    await member.mutation(api.tally.clientsCreate, { userId: "owner", id: "client", name: "Original" });
    const restricted = base.withIdentity({ subject: "owner", role });
    await expect(restricted.mutation(api.tally.clientsUpdate, { userId: "owner", id: "client", patch: { name: "Modified" } })).rejects.toThrow("Viewers have read-only access");
    expect(await restricted.query(api.tally.clientsGet, { userId: "owner", id: "client" })).toMatchObject({ name: "Original" });
    expect(await restricted.query(api.workspace.revision, { userId: "owner" })).toBe(1);
  });
});
