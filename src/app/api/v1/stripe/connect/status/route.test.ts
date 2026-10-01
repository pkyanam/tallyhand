import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ userId: "owner" as string | null, storage: "convex", meta: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ tryResolveSessionUserId: async () => state.userId }));
vi.mock("@/lib/mode", () => ({ parseStorage: () => state.storage }));
vi.mock("@/lib/stripe-connect/store", () => ({ getStripeConnectionMeta: state.meta }));
import { GET } from "./route";
beforeEach(() => { state.userId = "owner"; state.storage = "convex"; state.meta.mockReset(); });
describe("Stripe Connect status capability", () => {
  it("reports unsupported Convex capability without throwing or reading a different database", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { connected: false, supported: false } });
    expect(state.meta).not.toHaveBeenCalled();
  });
  it("requires a signed-in session", async () => {
    state.userId = null;
    expect((await GET()).status).toBe(401);
  });
  it("preserves supported provider status", async () => {
    state.storage = "postgres";
    state.meta.mockResolvedValue({ accountId: "acct_test_fixture", livemode: false, chargesEnabled: false, payoutsEnabled: false });
    expect(await (await GET()).json()).toMatchObject({ data: { connected: true, supported: true, livemode: false } });
  });
  it("returns a generic recoverable failure without exposing provider details", async () => {
    state.storage = "postgres";
    state.meta.mockRejectedValue(new Error("private database details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
