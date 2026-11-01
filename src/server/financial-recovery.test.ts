import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Payment, PaymentAttempt } from "@/core/financial/types";
import type { FinancialStore } from "@/core/financial/store";
const m = vi.hoisted(() => ({
  sessions: vi.fn(),
  refunds: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("./stripe-connect", () => ({
  resolveCheckoutStripeKey: async () => ({
    secretKey: "sk_test_x",
    stripeAccount: "acct",
    mode: "test",
  }),
  getConnectAccount: vi.fn(),
}));
vi.mock("@/plugins/stripe/stripe-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/stripe/stripe-client")>()),
  listCheckoutSessions: m.sessions,
  listPaymentRefunds: m.refunds,
  retrieveCheckoutSession: m.retrieve,
}));
import {
  recoverFinancialWork,
  deliverFinancialOutbox,
} from "./financial-recovery";
const scope = {
  userId: "u",
  workspaceId: "u",
  provider: "stripe" as const,
  accountId: "acct",
  mode: "test" as const,
};
const attempt: PaymentAttempt = {
  requestId: "request", operationId: "operation", requestFingerprint: "request-fingerprint",
  providerIdempotencyKey: "provider-key", actor: { kind: "owner", id: "u" }, updatedAt: 1,
  id: "a",
  scope,
  state: "unknown",
  createdAt: 1,
  invoice: {
    invoiceId: "i",
    revision: "1",
    fingerprint: "full",
    money: { minorUnits: 100, currency: "USD" },
  },
};
function store() {
  return {
    listResumableWork: vi.fn().mockResolvedValue({ items: [attempt] }),
    listPayments: vi.fn().mockResolvedValue({ items: [] }),
    reconcileAttempt: vi.fn(),
    applyPaymentOutcome: vi.fn(),
    applyRefundOutcome: vi.fn(),
  } as unknown as FinancialStore;
}

it("bounds plugin delivery even when the caller supplies no deadline", async () => {
  vi.useFakeTimers();
  try {
    const finishOutbox = vi.fn().mockResolvedValue(undefined);
    const durable = {
      claimOutbox: vi.fn().mockResolvedValue({
        id: "outbox",
        topic: "payment.confirmed",
        payload: "{}",
      }),
      finishOutbox,
    } as unknown as FinancialStore;
    const run = deliverFinancialOutbox(
      durable,
      scope,
      () => new Promise<void>(() => {}),
      1,
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await run;
    expect(finishOutbox).toHaveBeenCalledWith(
      scope,
      "outbox",
      expect.any(String),
      expect.objectContaining({
        delivered: false,
        failure: "Outbox delivery unavailable",
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});
afterEach(() => vi.restoreAllMocks());
describe("financial recovery", () => {
  it("finds unknown creates through paginated reads and persists URL", async () => {
    const session = {
      id: "cs",
      url: "https://checkout.stripe.com/cs",
      livemode: false,
      amount_total: 100,
      currency: "usd",
      payment_status: "unpaid",
      metadata: {
        attemptId: "a",
        invoiceId: "i",
        accountId: "acct",
        invoiceFingerprint: createHash("sha256").update("full").digest("hex"),
      },
    };
    m.sessions
      .mockResolvedValueOnce({ data: [{ id: "other" }], has_more: true })
      .mockResolvedValueOnce({ data: [session], has_more: false });
    const s = store();
    await recoverFinancialWork(s, scope);
    expect(m.sessions).toHaveBeenLastCalledWith(
      "sk_test_x",
      -59999,
      "acct",
      "other",
    );
    expect(s.reconcileAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          state: "pending",
          checkoutSessionId: "cs",
          checkoutUrl: session.url,
        },
      }),
    );
    expect(s.applyPaymentOutcome).not.toHaveBeenCalled();
  });
  it("leaves an empty provider lookup unknown", async () => {
    m.sessions.mockResolvedValue({ data: [], has_more: false });
    const s = store();
    await recoverFinancialWork(s, scope);
    expect(s.reconcileAttempt).not.toHaveBeenCalled();
    expect(s.applyPaymentOutcome).not.toHaveBeenCalled();
  });
  it("recovers confirmed refunds from known payments", async () => {
    const s = store();
    vi.mocked(s.listResumableWork).mockResolvedValue({ items: [] });
    vi.mocked(s.listPayments).mockResolvedValue({
      items: [{ scope, providerPaymentId: "pi" } as never],
    });
    m.refunds.mockResolvedValue({
      data: [
        {
          id: "re",
          livemode: false,
          payment_intent: "pi",
          amount: 40,
          currency: "usd",
          status: "succeeded",
        },
      ],
      has_more: false,
    });
    await recoverFinancialWork(s, scope);
    expect(s.applyRefundOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRefundId: "re",
        state: "confirmed",
        money: { currency: "USD", minorUnits: 40 },
      }),
    );
  });
  it("retires positively verified expired unpaid sessions, never an empty lookup", async () => {
    m.sessions.mockResolvedValue({
      data: [
        {
          id: "cs",
          status: "expired",
          payment_status: "unpaid",
          livemode: false,
          amount_total: 100,
          currency: "usd",
          metadata: {
            attemptId: "a",
            invoiceId: "i",
            accountId: "acct",
            invoiceFingerprint: createHash("sha256")
              .update("full")
              .digest("hex"),
          },
        },
      ],
      has_more: false,
    });
    const s = store();
    await recoverFinancialWork(s, scope);
    expect(s.reconcileAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          state: "failed",
          failure: "Stripe checkout expired unpaid",
          checkoutSessionId: "cs",
        },
      }),
    );
    expect(s.applyPaymentOutcome).not.toHaveBeenCalled();
  });
  it("persists opaque per-item cursors and gives both work and refunds time across long reads", async () => {
    vi.clearAllMocks();
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const attempts = Array.from({ length: 6 }, (_, i) => ({
      ...attempt,
      id: `a${i}`,
      checkoutSessionId: `cs${i}`,
      state: "pending" as const,
    }));
    const payments: Payment[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, invoice: attempt.invoice, attemptId: `a${i}`, money: attempt.invoice.money, confirmedAt: 1,
      scope,
      providerPaymentId: `pi${i}`,
    }));
    const visitedSessions: string[] = [],
      visitedPayments: string[] = [];
    const s = store();
    const page = <T>(items: T[], cursor?: string) => {
      const offset = cursor ? Number(cursor.replace("opaque:", "")) : 0;
      return {
        items: items.slice(offset, offset + 1),
        ...(offset + 1 < items.length
          ? { nextCursor: `opaque:${offset + 1}` }
          : {}),
      };
    };
    vi.mocked(s.listResumableWork).mockImplementation(
      async (_scope, _now, q) => {
        expect(q.limit).toBe(1);
        return page(attempts, q.cursor);
      },
    );
    vi.mocked(s.listPayments).mockImplementation(async (_scope, q) => {
      expect(q.limit).toBe(1);
      return page(payments, q.cursor);
    });
    m.retrieve.mockImplementation(async (_key, id) => {
      now += 10_000;
      visitedSessions.push(id);
      return {
        id,
        url: `https://checkout.stripe.com/${id}`,
        payment_status: "unpaid",
        livemode: false,
        amount_total: 100,
        currency: "usd",
        metadata: {
          attemptId: `a${id.replace("cs", "")}`,
          invoiceId: "i",
          accountId: "acct",
          invoiceFingerprint: createHash("sha256").update("full").digest("hex"),
        },
      };
    });
    m.refunds.mockImplementation(async (_key, id) => {
      now += 10_000;
      visitedPayments.push(id);
      return { data: [], has_more: false };
    });
    let cursors: { workCursor?: string; paymentCursor?: string; providerCursors?: Record<string, string> } = {};
    for (let run = 0; run < 3; run++) {
      const r = await recoverFinancialWork(s, scope, 20, {
        ...cursors,
        deadline: now + 45_000,
      });
      cursors = {
        workCursor: r.nextCursor,
        paymentCursor: r.paymentCursor,
        providerCursors: r.providerCursors,
      };
      if (run === 0) {
        expect(cursors.workCursor).toBe("opaque:3");
        expect(cursors.paymentCursor).toBe("opaque:2");
      }
    }
    expect(new Set(visitedSessions)).toEqual(
      new Set(attempts.map((a) => a.checkoutSessionId)),
    );
    expect(new Set(visitedPayments)).toEqual(
      new Set(payments.map((p) => p.providerPaymentId)),
    );
  });
});
