import { describe, expect, it } from "vitest";
import { computeLineAmount, invoiceTaxTotals } from "../invoice";
import {
  assertPaymentOutcome,
  confirmedRefundBalance,
  freezeInvoiceSnapshot,
  nextRefundState,
  providerIdentityKey,
} from "./invariants";
import { legacyTotalToMoney, money } from "./money";
import type { FinancialScope, PaymentAttempt, Refund } from "./types";

const scope: FinancialScope = {
  userId: "u",
  workspaceId: "w",
  provider: "stripe",
  accountId: "acct",
  mode: "test",
};
const invoice = freezeInvoiceSnapshot({
  invoiceId: "i",
  revision: "1",
  fingerprint: "f",
  money: money(1000, "USD"),
});
const attempt: PaymentAttempt = {
  id: "a",
  requestId: "r",
  scope,
  invoice,
  operationId: "op",
  requestFingerprint: "fp",
  providerIdempotencyKey: "key",
  actor: { kind: "owner", id: "u" },
  state: "pending",
  createdAt: 1,
  updatedAt: 1,
};

describe("online money boundary", () => {
  it.each(["USD", "EUR"])(
    "preserves reviewed %s legacy line/tax totals",
    (currency) => {
      const line = {
        id: "line",
        description: "work",
        quantity: 1.33,
        rate: 17.25,
        amount: computeLineAmount(1.33, 17.25),
        taxRate: 8.5,
        sourceType: "manual" as const,
      };
      const totals = invoiceTaxTotals([line]);
      expect(totals).toMatchObject({
        subtotal: 22.94,
        taxTotal: 1.95,
        total: 24.89,
      });
      expect(legacyTotalToMoney(totals.total, currency)).toEqual({
        currency,
        minorUnits: 2489,
      });
      expect(legacyTotalToMoney(0.29, currency).minorUnits).toBe(29);
    },
  );
  it.each([NaN, Infinity, -1, 1.001, 1.005, Number.MAX_SAFE_INTEGER])(
    "rejects unrepresentable total %s",
    (total) => {
      expect(() => legacyTotalToMoney(total, "USD")).toThrow();
    },
  );
  it("does not infer cents for unsupported currencies", () => {
    expect(() => legacyTotalToMoney(100, "JPY")).toThrow("Unsupported");
    expect(() => money(1.5, "USD")).toThrow();
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow();
  });
  it("freezes a copied snapshot without retaining mutable money", () => {
    expect(Object.isFrozen(invoice)).toBe(true);
    expect(Object.isFrozen(invoice.money)).toBe(true);
  });
});

describe("pure financial invariants", () => {
  const outcome = {
    scope,
    attemptId: "a",
    providerPaymentId: "pi",
    money: money(1000, "USD"),
    confirmedAt: 1,
    source: { kind: "reconciliation" as const, reference: "lookup" },
  };
  it("requires every frozen identity and amount to match", () => {
    expect(() => assertPaymentOutcome(attempt, outcome)).not.toThrow();
    for (const key of ["userId", "workspaceId", "accountId", "mode"] as const) {
      expect(() =>
        assertPaymentOutcome(attempt, {
          ...outcome,
          scope: { ...scope, [key]: "other" } as FinancialScope,
        }),
      ).toThrow();
    }
    expect(() =>
      assertPaymentOutcome(attempt, { ...outcome, money: money(1000, "EUR") }),
    ).toThrow();
    expect(() =>
      assertPaymentOutcome(attempt, { ...outcome, money: money(999, "USD") }),
    ).toThrow();
    expect(() =>
      assertPaymentOutcome(
        { ...attempt, providerPaymentId: "different" },
        outcome,
      ),
    ).toThrow();
  });
  it("separates scoped object identities including delimiter-containing IDs", () => {
    expect(providerIdentityKey(scope, "pi")).not.toBe(
      providerIdentityKey({ ...scope, mode: "live" }, "pi"),
    );
    expect(providerIdentityKey({ ...scope, userId: "u,w" }, "pi")).not.toBe(
      providerIdentityKey({ ...scope, workspaceId: "w,w" }, "pi"),
    );
  });
  it("subtracts only confirmed refunds and prevents confirmation regression", () => {
    const base = {
      id: "rf",
      scope,
      paymentId: "p",
      providerPaymentId: "pi",
      providerRefundId: "re",
      updatedAt: 2,
      money: money(400, "USD"),
    };
    const refunds: Refund[] = [
      { ...base, state: "pending" },
      { ...base, state: "failed" },
      { ...base, state: "confirmed" },
    ];
    expect(confirmedRefundBalance(invoice.money, refunds).minorUnits).toBe(600);
    expect(nextRefundState("confirmed", "failed")).toBe("confirmed");
    expect(() =>
      confirmedRefundBalance(invoice.money, [
        { ...base, state: "confirmed", money: money(1001, "USD") },
      ]),
    ).toThrow();
  });
});
