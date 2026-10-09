import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  owner: vi.fn(),
  store: vi.fn(),
  receive: vi.fn(),
  process: vi.fn(),
}));
vi.mock("@/lib/mode", () => ({ isHosted: () => true }));
vi.mock("@/lib/stripe-connect/store", () => ({
  findUserIdByStripeAccount: m.owner,
}));
vi.mock("@/server/financial-store", () => ({ getFinancialStore: m.store }));
vi.mock("@/server/financial-events", () => ({
  receiveStripeEvent: m.receive,
  processFinancialEvent: m.process,
}));
vi.mock("@/server/financial-notifications", () => ({
  drainFinancialNotifications: vi.fn(),
}));
import { POST } from "./route";
function request(account?: string) {
  const raw = JSON.stringify({
    id: "evt",
    type: "checkout.session.completed",
    account,
    livemode: false,
    data: { object: {} },
  });
  const t = Math.floor(Date.now() / 1000);
  return new Request("https://test/webhook", {
    method: "POST",
    body: raw,
    headers: {
      "stripe-signature": `t=${t},v1=${createHmac("sha256", "whsec_test").update(`${t}.${raw}`).digest("hex")}`,
    },
  });
}
beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.clearAllMocks();
  m.owner.mockResolvedValue("u");
  m.receive.mockResolvedValue({ event: { id: "r" } });
});
describe("webhook receipt", () => {
  it("routes by account and mode and commits inbox before processing", async () => {
    expect((await POST(request("acct"))).status).toBe(200);
    expect(m.owner).toHaveBeenCalledWith("acct", false);
    expect(m.receive.mock.invocationCallOrder[0]).toBeLessThan(
      m.process.mock.invocationCallOrder[0],
    );
  });
  it("does not fall back to hosted owner", async () => {
    expect((await POST(request())).status).toBe(503);
    expect(m.receive).not.toHaveBeenCalled();
  });
  it("does not acknowledge unavailable receipt persistence", async () => {
    m.receive.mockRejectedValueOnce(new Error("db"));
    expect((await POST(request("acct"))).status).toBe(503);
  });
});
