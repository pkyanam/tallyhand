import { assertSameMoney, money, netConfirmedMoney } from "./money";
import type {
  FinancialScope,
  InvoiceSnapshot,
  PaymentAttempt,
  Refund,
  RefundState,
} from "./types";
import type { PaymentOutcomeInput } from "./store";

export function assertFinancialScope(
  actual: FinancialScope,
  expected: FinancialScope,
): void {
  for (const key of [
    "userId",
    "workspaceId",
    "provider",
    "accountId",
    "mode",
  ] as const) {
    if (!actual[key] || actual[key] !== expected[key])
      throw new Error(`Financial scope mismatch: ${key}`);
  }
}

/** Composite uniqueness key includes tenant, account and provider mode. */
export function providerIdentityKey(
  scope: FinancialScope,
  objectId: string,
): string {
  assertFinancialScope(scope, scope);
  if (!objectId) throw new Error("Provider object identity required");
  return JSON.stringify([
    scope.userId,
    scope.workspaceId,
    scope.provider,
    scope.accountId,
    scope.mode,
    objectId,
  ]);
}

export function freezeInvoiceSnapshot(input: InvoiceSnapshot): InvoiceSnapshot {
  if (!input.invoiceId || !input.revision || !input.fingerprint)
    throw new Error("Invoice snapshot identity required");
  return Object.freeze({
    ...input,
    money: money(input.money.minorUnits, input.money.currency),
  });
}

export function assertPaymentOutcome(
  attempt: PaymentAttempt,
  outcome: PaymentOutcomeInput,
): void {
  assertFinancialScope(outcome.scope, attempt.scope);
  if (outcome.attemptId !== attempt.id)
    throw new Error("Payment attempt mismatch");
  if (!outcome.providerPaymentId)
    throw new Error("Provider payment identity required");
  if (
    attempt.providerPaymentId &&
    attempt.providerPaymentId !== outcome.providerPaymentId
  )
    throw new Error("Provider payment identity mismatch");
  assertSameMoney(outcome.money, attempt.invoice.money);
  if (outcome.money.minorUnits === 0)
    throw new Error("Collection amount must be positive");
}

export function nextRefundState(
  current: RefundState | undefined,
  observed: RefundState,
): RefundState {
  // Late pending/failed callbacks cannot undo already confirmed money.
  return current === "confirmed" ? "confirmed" : observed;
}

export function confirmedRefundBalance(
  payment: PaymentAttempt["invoice"]["money"],
  refunds: readonly Refund[],
) {
  return netConfirmedMoney(
    payment,
    refunds
      .filter((refund) => refund.state === "confirmed")
      .map((refund) => refund.money),
  );
}
