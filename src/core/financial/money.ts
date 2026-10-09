/** Online collection support is deliberately narrower than invoice display support. */
export const ONLINE_CURRENCIES = Object.freeze({
  USD: Object.freeze({ code: "USD", exponent: 2, minorUnit: "cent" }),
  EUR: Object.freeze({ code: "EUR", exponent: 2, minorUnit: "cent" }),
} as const);
export type OnlineCurrency = keyof typeof ONLINE_CURRENCIES;
export interface Money {
  readonly currency: OnlineCurrency;
  readonly minorUnits: number;
}

export function onlineCurrency(code: string): OnlineCurrency {
  const normalized = code.toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(ONLINE_CURRENCIES, normalized)) {
    throw new Error(`Unsupported online currency: ${code}`);
  }
  return normalized as OnlineCurrency;
}

export function money(minorUnits: number, currency: string): Money {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error("Money requires nonnegative safe integer minor units");
  }
  return Object.freeze({ currency: onlineCurrency(currency), minorUnits });
}

/** Convert an already reviewed legacy total; never recompute historical lines/tax. */
export function legacyTotalToMoney(total: number, currency: string): Money {
  const code = onlineCurrency(currency);
  if (!Number.isFinite(total) || total < 0)
    throw new Error("Invalid online amount");
  const factor = 10 ** ONLINE_CURRENCIES[code].exponent;
  const units = Math.round(total * factor);
  // This admits binary floating-point noise, but rejects actual fractional cents.
  const tolerance = Math.min(
    1e-7,
    Math.max(1, Math.abs(total * factor)) * Number.EPSILON * 2,
  );
  if (Math.abs(total * factor - units) > tolerance) {
    throw new Error(
      "Online amount is not representable in currency minor units",
    );
  }
  return money(units, code);
}

export function assertSameMoney(actual: Money, expected: Money): void {
  money(actual.minorUnits, actual.currency);
  money(expected.minorUnits, expected.currency);
  if (
    actual.currency !== expected.currency ||
    actual.minorUnits !== expected.minorUnits
  ) {
    throw new Error("Financial amount/currency mismatch");
  }
}

export function netConfirmedMoney(
  payment: Money,
  refunds: readonly Money[],
): Money {
  money(payment.minorUnits, payment.currency);
  let remaining = payment.minorUnits;
  for (const refund of refunds) {
    money(refund.minorUnits, refund.currency);
    if (refund.currency !== payment.currency)
      throw new Error("Refund currency mismatch");
    remaining -= refund.minorUnits;
    if (remaining < 0) throw new Error("Confirmed refunds exceed payment");
  }
  return money(remaining, payment.currency);
}
