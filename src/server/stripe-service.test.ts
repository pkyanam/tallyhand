import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { receiveStripeEvent, processFinancialEvent } from "./financial-events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "@/core/storage";
import { SqliteFinancialStore } from "@/lib/financial/sqlite-store";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  auth: vi.fn(),
  create: vi.fn(),
}));
vi.mock("./financial-store", () => ({ getFinancialStore: mocks.get }));
vi.mock("./financial-authority", () => ({ authorizeFinancial: mocks.auth }));
vi.mock("./stripe-connect", () => ({
  getConnectAccount: vi.fn(),
  resolveCheckoutStripeKey: async () => ({
    secretKey: "sk_test_x",
    stripeAccount: "acct",
    mode: "test",
    source: "connected",
  }),
}));
vi.mock("@/plugins/stripe/stripe-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/stripe/stripe-client")>()),
  createCheckoutSession: mocks.create,
}));
import { createInvoiceCheckoutSession } from "./stripe-service";
const invoice = {
  id: "i",
  invoiceNumber: "INV",
  status: "sent",
  total: 1,
  currency: "USD",
  updatedAt: 1,
};
const opts = {
  userId: "local",
  operationId: "op",
  authority: { kind: "owner" as const, userId: "local" },
};
const provider = {
  getInvoice: async () => invoice,
  getClient: vi.fn(),
  getSettings: async () => ({}),
} as unknown as StorageProvider;
let store: SqliteFinancialStore;
let directory: string, path: string;
beforeEach(() => {
  vi.stubEnv("TALLYHAND_APP_URL", "https://test.example");
  directory = mkdtempSync(join(tmpdir(), "checkout-"));
  path = join(directory, "financial.sqlite");
  store = new SqliteFinancialStore(path);
  const db = (store as unknown as { db: DatabaseSync }).db;
  db.exec(
    "CREATE TABLE invoices(id TEXT,status TEXT,updated_at INTEGER,data TEXT)",
  );
  db.prepare("INSERT INTO invoices VALUES(?,?,?,?)").run(
    "i",
    "sent",
    1,
    JSON.stringify(invoice),
  );
  mocks.get.mockResolvedValue(store);
  mocks.auth.mockResolvedValue({ actor: { kind: "owner", id: "local" } });
  mocks.create.mockReset();
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("durable checkout", () => {
  it("persists before dispatch and reuses the checkout URL", async () => {
    mocks.create.mockResolvedValue({
      id: "cs",
      url: "https://checkout.stripe.com/cs",
    });
    const first = await createInvoiceCheckoutSession(provider, "i", opts);
    const second = await createInvoiceCheckoutSession(provider, "i", {
      ...opts,
      operationId: "another",
    });
    expect(second).toEqual(first);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][1].idempotencyKey).toBeTruthy();
  });
  it("uncertain timeout is never dispatched again", async () => {
    mocks.create.mockRejectedValue(new Error("timeout"));
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 202 });
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 202 });
    store.close();
    store = new SqliteFinancialStore(path);
    mocks.get.mockResolvedValue(store);
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 202 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("an event arriving before the create response cannot be overwritten", async () => {
    mocks.create.mockImplementationOnce(async (_key, params) => {
      const metadata = params.metadata;
      const scope = {
        userId: "local",
        workspaceId: "local",
        provider: "stripe" as const,
        accountId: "acct",
        mode: "test" as const,
      };
      const receipt = await receiveStripeEvent(store, scope, {
        id: "evt",
        type: "checkout.session.completed",
        account: "acct",
        livemode: false,
        data: {
          object: {
            id: "cs",
            livemode: false,
            payment_intent: "pi",
            payment_status: "paid",
            amount_total: 100,
            currency: "usd",
            metadata,
          },
        },
      });
      await processFinancialEvent(store, receipt.event);
      return { id: "cs", url: "https://checkout.stripe.com/cs" };
    });
    // Confirmed state is retained even when a response has no persisted URL.
    try {
      await createInvoiceCheckoutSession(provider, "i", opts);
    } catch (error) {
      expect(error).toMatchObject({ status: 202 });
    }
    const metadata = mocks.create.mock.calls[0][1].metadata;
    expect(
      (
        await store.getAttempt(
          {
            userId: "local",
            workspaceId: "local",
            provider: "stripe",
            accountId: "acct",
            mode: "test",
          },
          metadata.attemptId,
        )
      )?.state,
    ).toBe("confirmed");
    expect(
      (
        await store.listPayments(
          { userId: "local", workspaceId: "local" },
          { limit: 10 },
        )
      ).items,
    ).toHaveLength(1);
  });
  it("lost dispatch-result persistence retains the original durable key", async () => {
    mocks.create.mockResolvedValueOnce({
      id: "cs",
      url: "https://checkout.stripe.com/cs",
    });
    const spy = vi
      .spyOn(store, "recordAttemptDispatch")
      .mockRejectedValue(new Error("database offline"));
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 503 });
    const key = mocks.create.mock.calls[0][1].idempotencyKey;
    spy.mockRestore();
    store.close();
    store = new SqliteFinancialStore(path);
    mocks.get.mockResolvedValue(store);
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 202 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const timeline = await store.getInvoiceTimeline(
      { userId: "local", workspaceId: "local" },
      "i",
      { limit: 10 },
    );
    expect(timeline.attempts[0].providerIdempotencyKey).toBe(key);
  });

  it("expired unpaid checkout requires a new operation and never returns the dead URL", async () => {
    mocks.create
      .mockResolvedValueOnce({
        id: "expired_cs",
        url: "https://checkout.stripe.com/dead",
      })
      .mockResolvedValueOnce({
        id: "fresh_cs",
        url: "https://checkout.stripe.com/fresh",
      });
    await createInvoiceCheckoutSession(provider, "i", opts);
    const metadata = mocks.create.mock.calls[0][1].metadata;
    const scope = {
      userId: "local",
      workspaceId: "local",
      provider: "stripe" as const,
      accountId: "acct",
      mode: "test" as const,
    };
    const receipt = await receiveStripeEvent(store, scope, {
      id: "expired_event",
      type: "checkout.session.expired",
      account: "acct",
      livemode: false,
      data: {
        object: {
          id: "expired_cs",
          status: "expired",
          payment_status: "unpaid",
          livemode: false,
          amount_total: 100,
          currency: "usd",
          metadata,
        },
      },
    });
    await processFinancialEvent(store, receipt.event);
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await createInvoiceCheckoutSession(provider, "i", {
          ...opts,
          operationId: "new_op",
        })
      ).sessionId,
    ).toBe("fresh_cs");
    expect(mocks.create.mock.calls[1][1].idempotencyKey).not.toBe(
      mocks.create.mock.calls[0][1].idempotencyKey,
    );
  });
  it("requires authority and denies before preparing", async () => {
    mocks.auth.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { status: 403 }),
    );
    await expect(
      createInvoiceCheckoutSession(provider, "i", opts),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
