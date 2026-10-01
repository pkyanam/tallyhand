import { describe, expect, it, vi } from "vitest";
const { query, mutation } = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; mutation = mutation; } }));
import { createConvexRequestClient } from "./convex-client";
const secret = "synthetic-local-fixture-only-123456789";
describe("Convex server transport", () => {
  it.each([["NOT_FOUND", 404], ["CONFLICT", 409], ["BAD_REQUEST", 400]])("maps %s to a safe API status", async (code, status) => {
    mutation.mockRejectedValueOnce({ data: { code }, message: secret });
    const client = createConvexRequestClient("https://fixture.convex.cloud", () => secret);
    await expect(client.mutation("extensions:create", {})).rejects.toMatchObject({ status });
  });
  it("does not expose raw provider errors or credential arguments", async () => {
    query.mockRejectedValueOnce(new Error(`Provider rejected args containing ${secret}`));
    const client = createConvexRequestClient("https://fixture.convex.cloud", () => secret);
    await expect(client.query("tally:clientsList", { userId: "owner" })).rejects.toMatchObject({ message: "Cloud storage request failed", status: 503 });
  });
  it("retains permission status without leaking provider details", async () => {
    mutation.mockRejectedValueOnce({ data: { code: "FORBIDDEN" }, message: secret });
    const client = createConvexRequestClient("https://fixture.convex.cloud", () => secret);
    await expect(client.mutation("tally:clientsCreate", {})).rejects.toMatchObject({ message: "Access denied", status: 403 });
  });
});
