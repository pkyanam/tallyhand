import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { snapshotInvoice } from "@/core/financial/snapshot";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteFinancialStore } from "@/lib/financial/sqlite-store";
import {
  processFinancialEvent,
  receiveStripeEvent,
  type StripeEvent,
} from "./financial-events";
const scope = {
  userId: "local",
  workspaceId: "local",
  provider: "stripe" as const,
  accountId: "acct_1",
  mode: "test" as const,
};
let store: SqliteFinancialStore;
afterEach(() => store?.close());
async function setup() {
  store = new SqliteFinancialStore(":memory:");
  const invoice = {
    id: "i",
    status: "sent" as const,
    updatedAt: 1,
    total: 1,
    currency: "USD",
  };
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
  return (
    await store.prepareAttempt({
      scope,
      invoice: snapshotInvoice(invoice as never),
      operationId: "op",
      requestFingerprint: "f",
      actor: { kind: "owner", id: "local" },
      now: 1,
    })
  ).attempt;
}
async function deliver(
  id: string,
  type: string,
  object: Record<string, unknown>,
) {
  const e: StripeEvent = {
    id,
    type,
    livemode: false,
    account: "acct_1",
    data: { object },
  };
  const receipt = await receiveStripeEvent(store, scope, e);
  await processFinancialEvent(store, receipt.event);
  return receipt;
}
describe("durable financial events", () => {
  it("confirms an event before create response and deduplicates different events for one payment", async () => {
    const a = await setup();
    const session = {
      id: "cs",
      livemode: false,
      payment_status: "paid",
      payment_intent: "pi",
      amount_total: 100,
      currency: "usd",
      metadata: {
        attemptId: a.id,
        invoiceId: "i",
        invoiceFingerprint: createHash("sha256")
          .update(a.invoice.fingerprint)
          .digest("hex"),
        accountId: "acct_1",
      },
    };
    await deliver("e1", "checkout.session.completed", session);
    await deliver("e2", "checkout.session.async_payment_succeeded", session);
    expect((await store.listPayments(scope, { limit: 10 })).items).toHaveLength(
      1,
    );
    expect((await store.getAttempt(scope, a.id))?.state).toBe("confirmed");
  });
  it("keeps unknown refund parents retryable and confirms once parent arrives", async () => {
    const a = await setup();
    const refund = {
      id: "re",
      payment_intent: "pi",
      status: "succeeded",
      amount: 40,
      currency: "usd",
    };
    const r = await deliver("r1", "refund.created", refund);
    expect(
      (
        await store.listResumableWork(scope, Date.now() + 60_000, { limit: 10 })
      ).items.some((x) => x.id === r.event.id),
    ).toBe(true);
    await deliver("e", "checkout.session.completed", {
      id: "cs",
      livemode: false,
      payment_status: "paid",
      payment_intent: "pi",
      amount_total: 100,
      currency: "usd",
      metadata: {
        attemptId: a.id,
        invoiceId: "i",
        invoiceFingerprint: createHash("sha256")
          .update(a.invoice.fingerprint)
          .digest("hex"),
        accountId: "acct_1",
      },
    });
    await deliver("r2", "refund.updated", refund);
    await deliver("r3", "refund.updated", { ...refund, status: "pending" });
    const t = await store.getInvoiceTimeline(scope, "i", { limit: 10 });
    expect(t.refunds).toHaveLength(1);
    expect(t.refunds[0].state).toBe("confirmed");
  });
  it("rejects overpayment and missing payment identity", async () => {
    const a = await setup();
    await deliver("bad", "checkout.session.completed", {
      id: "cs",
      livemode: false,
      payment_status: "paid",
      amount_total: 101,
      currency: "usd",
      metadata: {
        attemptId: a.id,
        invoiceId: "i",
        invoiceFingerprint: createHash("sha256")
          .update(a.invoice.fingerprint)
          .digest("hex"),
        accountId: "acct_1",
      },
    });
    expect((await store.listPayments(scope, { limit: 10 })).items).toHaveLength(
      0,
    );
  });
});
