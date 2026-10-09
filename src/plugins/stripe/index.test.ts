import { beforeEach, expect, it, vi } from "vitest";
import { requestSharePayment, resetSharePaymentHandlerForTests } from "@/lib/share/payment-slot";
const mocks = vi.hoisted(() => ({ checkout: vi.fn() }));
vi.mock("@/server/provider", () => ({ getServerProviderForUser: () => ({}) }));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: () => ({}) }));
vi.mock("@/lib/share/service", () => ({ resolveShareToken: async () => ({ link: { userId: "owner", id: "same-link" }, invoice: { id: "invoice" } }) }));
vi.mock("@/server/stripe-service", () => ({ getStripeConfig: () => ({}), createInvoiceCheckoutSession: mocks.checkout }));
import { stripePlugin } from "./index";

beforeEach(() => {
  resetSharePaymentHandlerForTests();
  mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.test" });
});
it("preserves each logical request identity rather than pinning every payer click to the share link", async () => {
  await stripePlugin.activate({ settings: { registerSection: vi.fn() }, hooks: { on: vi.fn() } } as never);
  const request = { shareToken: "token", ownerId: "owner", shareLinkId: "same-link", invoiceId: "invoice", invoiceNumber: "INV", amountCents: 100, currency: "USD" };
  await requestSharePayment({ ...request, operationId: "original-operation" });
  await requestSharePayment({ ...request, operationId: "original-operation" });
  await requestSharePayment({ ...request, operationId: "replacement-operation" });
  expect(mocks.checkout.mock.calls.map(call => call[2].operationId)).toEqual(["original-operation", "original-operation", "replacement-operation"]);
  expect(mocks.checkout.mock.calls[2][2].authority).toEqual({ kind: "customer", shareToken: "token" });
});
