import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SqliteFinancialStore } from "@/lib/financial/sqlite-store";
import { snapshotInvoice } from "@/core/financial/snapshot";
import { signShareToken } from "@/core/share";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({
  deps: undefined as unknown,
  store: undefined as unknown,
}));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: () => mocks.deps }));
vi.mock("@/server/financial-store", () => ({
  getFinancialStore: async () => mocks.store,
}));
const secret = "s".repeat(40);
const scope = {
  userId: "local",
  workspaceId: "local",
  provider: "stripe" as const,
  accountId: "private-account",
  mode: "test" as const,
};
let store: SqliteFinancialStore;
let link: {
  id: string;
  userId: string;
  type: string;
  target: { invoiceId: string };
  expiresAt: number;
  revokedAt: number | null;
};
let token: string;
beforeEach(() => {
  store = new SqliteFinancialStore(":memory:");
  mocks.store = store;
  (store as unknown as { db: DatabaseSync }).db.exec(
    "CREATE TABLE invoices(id TEXT,status TEXT,updated_at INTEGER,data TEXT)",
  );
  link = {
    id: "link",
    userId: "local",
    type: "invoice",
    target: { invoiceId: "shared" },
    expiresAt: Date.now() + 60000,
    revokedAt: null,
  };
  token = signShareToken(
    { v: 1, lid: link.id, typ: "invoice", exp: link.expiresAt },
    secret,
  );
  const provider = {
    getInvoice: async (id: string) => ({
      id,
      clientId: "client",
      cloudLinkEnabled: true,
    }),
    getClient: async () => null,
    getSettings: async () => ({}),
  };
  mocks.deps = {
    shareSecret: secret,
    ownerProvider: { getShareLinkById: async () => link },
    providerForUser: (userId: string) => {
      expect(userId).toBe("local");
      return provider;
    },
  };
});
afterEach(() => store.close());
async function payment(id: string, providerPaymentId: string) {
  (store as unknown as { db: DatabaseSync }).db
    .prepare("INSERT INTO invoices VALUES(?,?,?,?)")
    .run(
      id,
      "sent",
      1,
      JSON.stringify({
        id,
        status: "sent",
        total: 10,
        currency: "EUR",
        updatedAt: 1,
        notes: "private invoice snapshot",
      }),
    );
  const { attempt } = await store.prepareAttempt({
    scope,
    invoice: snapshotInvoice({
      id,
      status: "sent",
      total: 10,
      currency: "EUR",
      updatedAt: 1,
      notes: "private invoice snapshot",
    } as never),
    operationId: id,
    requestFingerprint: id,
    actor: { kind: "owner", id: "local" },
    now: 1,
  });
  const { event } = await store.receiveProviderEvent({
    scope,
    providerEventId: id,
    type: "paid",
    payload: "secret-event-payload",
    receivedAt: 2,
  });
  await store.applyPaymentOutcome({
    scope,
    attemptId: attempt.id,
    providerPaymentId,
    money: attempt.invoice.money,
    confirmedAt: 3,
    source: { kind: "event", eventId: event.id },
  });
  return event;
}
function request(extra: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/share/payment-status", {
      method: "POST",
      body: JSON.stringify({ token, ...extra }),
    }),
  );
}
it("isolates the invoice capability and publishes sanitized receipts with only confirmed refunds subtracted", async () => {
  const event = await payment("shared", "private-payment");
  await payment("other", "other-payment");
  for (const [state, units] of [
    ["confirmed", 200],
    ["pending", 300],
    ["failed", 100],
  ] as const)
    await store.applyRefundOutcome({
      scope,
      providerPaymentId: "private-payment",
      providerRefundId: state,
      state,
      money: { currency: "EUR", minorUnits: units },
      observedAt: 4,
      source: { kind: "event", eventId: event.id },
    });
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.receipts).toHaveLength(1);
  expect(body.receipts[0]).toMatchObject({
    confirmedRefundMinorUnits: 200,
    netMinorUnits: 800,
  });
  expect(body.refunds.map((r: { state: string }) => r.state).sort()).toEqual([
    "confirmed",
    "failed",
    "pending",
  ]);
  const serialized = JSON.stringify(body);
  for (const privateValue of [
    "private-account",
    "private-payment",
    "other-payment",
    "private invoice snapshot",
    "secret-event-payload",
    "fingerprint",
    "workspaceId",
    "checkoutUrl",
  ])
    expect(serialized).not.toContain(privateValue);
  expect(body.bankConfirmation).toBe("unverified");
});
it("rejects invoice substitution rather than widening the public capability", async () => {
  expect((await request({ invoiceId: "other" })).status).toBe(400);
});
it("does not expose receipts after link revocation", async () => {
  await payment("shared", "private-payment");
  link.revokedAt = Date.now();
  const response = await request();
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.json()).not.toHaveProperty("receipts");
});
