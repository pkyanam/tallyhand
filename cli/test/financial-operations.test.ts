import { expect, it, vi } from "vitest";
import { TallyhandClient } from "../src/client.js";
import { requestFinancialOperation } from "../src/workspace-operations.js";
import type { Api } from "../src/commands.js";

it("does not infer financial grant from broad authenticated workspace access", async () => {
  const request = vi.fn();
  const api = { hasToken: true, requestFinancialOperation: request } as unknown as Api;
  await expect(requestFinancialOperation(api, { action: "reconcile" })).rejects.toThrow();
  await expect(requestFinancialOperation(api, { action: "timeline", grant: "fixture" })).rejects.toThrow();
  await expect(requestFinancialOperation(api, { action: "checkout", invoiceId: "invoice", grant: "fixture" })).rejects.toThrow("stable operationId");
  expect(request).not.toHaveBeenCalled();
});

it("prepares checkout with the explicit collect grant and stable retry identity", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { url: "https://checkout.example.test" } }, { status: 201 }));
  const api = new TallyhandClient({ baseUrl: "https://example.test", token: "synthetic", fetcher });
  await requestFinancialOperation(api, { action: "checkout", invoiceId: "invoice", grant: "collect-grant", operationId: "reviewed-checkout-1" });
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe("/api/v1/stripe/payment-links");
  expect(new Headers(init.headers).get("X-Tally-Financial-Grant")).toBe("collect-grant");
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe("reviewed-checkout-1");
  expect(JSON.parse(init.body as string)).toEqual({ invoiceId: "invoice" });
});

it("sends an explicit financial grant only on the dedicated financial request", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { items: [], nextCursor: "next" } }));
  const api = new TallyhandClient({ baseUrl: "https://example.test", token: "synthetic", fetcher });
  expect(await requestFinancialOperation(api, { action: "payments", grant: "grant-fixture", limit: 1 })).toEqual({ items: [], nextCursor: "next" });
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe("/api/v1/financial/payments");
  expect(url.searchParams.get("limit")).toBe("1");
  expect(new Headers(init.headers).get("X-Tally-Financial-Grant")).toBe("grant-fixture");
  expect(() => api.requestWorkspaceOperation({ method: "POST", path: "/api/v1/financial/reconcile" })).toThrow("Unsupported workspace resource");
});
