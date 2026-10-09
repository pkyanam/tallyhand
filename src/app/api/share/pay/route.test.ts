import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ payment: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: () => ({}) }));
vi.mock("@/lib/share/service", () => ({ resolveShareToken: mocks.resolve }));
vi.mock("@/lib/share/payment-slot", () => ({ hasSharePaymentHandler: () => true, requestSharePayment: mocks.payment }));
import { POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ link: { userId: "owner", id: "link" }, invoice: { id: "invoice", invoiceNumber: "INV", total: 1, currency: "EUR" } });
  mocks.payment.mockResolvedValue({ handled: true });
});
function request(key?: string) {
  return new Request("http://localhost/api/share/pay", { method: "POST", headers: key === undefined ? {} : { "Idempotency-Key": key }, body: JSON.stringify({ token: "share-token" }) });
}
it.each([undefined, "", "unsafe/key", "x".repeat(129)])("requires a safe operation identity before delegation: %s", async key => {
  expect((await POST(request(key))).status).toBe(400);
  expect(mocks.payment).not.toHaveBeenCalled();
});
it("carries the caller's stable operation identity with the resolved capability", async () => {
  expect((await POST(request("logical-request-1"))).status).toBe(200);
  expect(mocks.payment).toHaveBeenCalledWith(expect.objectContaining({ operationId: "logical-request-1", shareLinkId: "link", ownerId: "owner", invoiceId: "invoice" }));
});
