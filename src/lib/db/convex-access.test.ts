import { afterEach, describe, expect, it, vi } from "vitest";
import { hasServerAccess, requireOwner } from "../../../convex/access";

function context(subject: string | null, role?: string) {
  return {
    auth: { getUserIdentity: async () => subject ? { subject, role } : null },
  } as unknown as Parameters<typeof requireOwner>[0];
}

afterEach(() => vi.unstubAllEnvs());

describe("Convex database authorization", () => {
  it("requires authentication and rejects mismatched ownership", async () => {
    await expect(requireOwner(context(null), { userId: "owner" })).rejects.toThrow();
    await expect(requireOwner(context("owner"), { userId: "other" })).rejects.toThrow();
    await expect(requireOwner(context("owner"), { userId: "owner" })).resolves.toBe("owner");
  });
  it("honors verified viewer role for direct writes", async () => {
    await expect(requireOwner(context("owner", "viewer"), { userId: "owner" }, true)).rejects.toThrow();
    await expect(requireOwner(context("owner", "viewer"), { userId: "owner" })).resolves.toBe("owner");
  });
  it("fails closed when the bridge is unconfigured or too short", () => {
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", "");
    expect(hasServerAccess("")).toBe(false);
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", "short");
    expect(hasServerAccess("short")).toBe(false);
  });
  it("accepts only the configured server bridge credential", async () => {
    const fixture = "synthetic-test-bridge-credential-1234567890";
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", fixture);
    expect(hasServerAccess(fixture + "x")).toBe(false);
    expect(hasServerAccess("x".repeat(fixture.length))).toBe(false);
    await expect(requireOwner(context(null), { serverSecret: fixture, userId: "owner" }, true)).resolves.toBe("owner");
    await expect(requireOwner(context(null), { serverSecret: fixture })).rejects.toThrow();
  });
});
