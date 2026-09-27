/**
 * Tax estimation for sole proprietors — pure calculations.
 *
 * Estimates quarterly federal estimated-tax payments from real profit:
 * self-employment tax (15.3% on 92.35% of net earnings) plus federal income
 * tax on taxable income (profit minus deductible half of SE tax, minus the
 * standard deduction) through a configurable bracket table.
 *
 * IMPORTANT: these are planning estimates, not tax advice. Bracket figures
 * default to the 2025 single-filer schedule — override via TaxConfig when
 * the IRS publishes a new year.
 */
import type { ID, Timestamped } from "./entities";

export interface TaxBracket {
  /** Upper bound of taxable income in this bracket (dollars). */
  upTo: number;
  /** Marginal rate as a decimal, e.g. 0.22. */
  rate: number;
}

/** 2025 federal single-filer brackets (IRS Rev. Proc. 2024-40). */
export const FEDERAL_BRACKETS_2025_SINGLE: TaxBracket[] = [
  { upTo: 11_925, rate: 0.1 },
  { upTo: 48_475, rate: 0.12 },
  { upTo: 103_350, rate: 0.22 },
  { upTo: 197_300, rate: 0.24 },
  { upTo: 250_525, rate: 0.32 },
  { upTo: 626_350, rate: 0.35 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
];

/** 2025 standard deduction, single filer. */
export const STANDARD_DEDUCTION_2025_SINGLE = 15_000;

/** 2025 Social Security wage base (only the 12.4% portion caps). */
export const SOCIAL_SECURITY_WAGE_BASE_2025 = 176_100;

export interface TaxConfig {
  brackets: TaxBracket[];
  standardDeduction: number;
  /** Fraction of net profit the user wants to set aside (e.g. 0.30). */
  setAsidePercent: number;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  brackets: FEDERAL_BRACKETS_2025_SINGLE,
  standardDeduction: STANDARD_DEDUCTION_2025_SINGLE,
  setAsidePercent: 0.3,
};

/** The slice of tax config persisted in Settings (brackets stay code-owned). */
export interface TaxSettings {
  /** Fraction of net profit to reserve for taxes, e.g. 0.30. */
  setAsidePercent: number;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = { setAsidePercent: 0.3 };

export interface TaxEstimate {
  netProfit: number;
  selfEmploymentTax: number;
  /** Deductible half of SE tax (above-the-line). */
  deductibleSeTaxHalf: number;
  taxableIncome: number;
  federalIncomeTax: number;
  /** SE + income: the annualized total federal liability. */
  totalTax: number;
  /** totalTax / 4. */
  quarterlyPayment: number;
  /** Suggested reserve balance right now. */
  setAsideTarget: number;
  effectiveRate: number | null;
}

/** SE tax: 15.3% of 92.35% of net earnings; 12.4% SS portion caps. */
export function selfEmploymentTax(netProfit: number): number {
  if (netProfit <= 0) return 0;
  const base = netProfit * 0.9235;
  const ssBase = Math.min(base, SOCIAL_SECURITY_WAGE_BASE_2025);
  return ssBase * 0.124 + base * 0.029;
}

/** Federal income tax through a marginal bracket table. */
export function federalIncomeTax(
  taxableIncome: number,
  brackets: TaxBracket[],
): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (taxableIncome <= prev) break;
    const inBracket = Math.min(taxableIncome, b.upTo) - prev;
    tax += inBracket * b.rate;
    prev = b.upTo;
  }
  return tax;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Full-year federal estimate from a net profit figure.
 * `netProfit` should be annualized profit (see `annualizeProfit`).
 */
export function estimateAnnualTax(
  netProfitAnnualized: number,
  config: TaxConfig = DEFAULT_TAX_CONFIG,
): TaxEstimate {
  const seTax = selfEmploymentTax(netProfitAnnualized);
  const deductibleHalf = seTax / 2;
  const taxableIncome = Math.max(
    0,
    netProfitAnnualized - deductibleHalf - config.standardDeduction,
  );
  const incomeTax = federalIncomeTax(taxableIncome, config.brackets);
  const totalTax = seTax + incomeTax;
  return {
    netProfit: round2(netProfitAnnualized),
    selfEmploymentTax: round2(seTax),
    deductibleSeTaxHalf: round2(deductibleHalf),
    taxableIncome: round2(taxableIncome),
    federalIncomeTax: round2(incomeTax),
    totalTax: round2(totalTax),
    quarterlyPayment: round2(totalTax / 4),
    setAsideTarget: round2(netProfitAnnualized * config.setAsidePercent),
    effectiveRate:
      netProfitAnnualized > 0 ? totalTax / netProfitAnnualized : null,
  };
}

/**
 * Annualize year-to-date profit: profit earned over `monthsElapsed` months
 * of the year, scaled to 12. `monthsElapsed` is clamped to [1, 12].
 */
export function annualizeProfit(
  profitYtd: number,
  monthsElapsed: number,
): number {
  const m = Math.min(12, Math.max(1, monthsElapsed));
  return (profitYtd / m) * 12;
}

export interface TaxQuarter {
  quarter: 1 | 2 | 3 | 4;
  /** ms epoch, UTC. */
  dueDate: number;
  label: string;
}

/**
 * Federal estimated-tax due dates for a tax year: Apr 15, Jun 15, Sep 15,
 * and Jan 15 of the following year. (Weekend/holiday shifts ignored —
 * the UI labels these as estimates.)
 */
export function quarterlyDueDates(taxYear: number): TaxQuarter[] {
  const mk = (y: number, m: number, d: number) => Date.UTC(y, m, d);
  return [
    { quarter: 1, dueDate: mk(taxYear, 3, 15), label: "Q1" },
    { quarter: 2, dueDate: mk(taxYear, 5, 15), label: "Q2" },
    { quarter: 3, dueDate: mk(taxYear, 8, 15), label: "Q3" },
    { quarter: 4, dueDate: mk(taxYear + 1, 0, 15), label: "Q4" },
  ];
}

/** The next quarterly due date at or after nowMs (null when the year is done). */
export function nextQuarterDue(
  taxYear: number,
  nowMs: number,
): TaxQuarter | null {
  return quarterlyDueDates(taxYear).find((q) => q.dueDate >= nowMs) ?? null;
}

export type TaxJurisdiction = "federal" | "state";

/** An estimated tax payment the user actually made (or scheduled). */
export interface TaxPayment extends Timestamped {
  id: ID;
  taxYear: number;
  quarter: 1 | 2 | 3 | 4;
  /** ms epoch the payment was/will be made. */
  date: number;
  amount: number;
  jurisdiction: TaxJurisdiction;
  method?: string;
  note?: string;
}

export type TaxPaymentCreateInput = Omit<
  TaxPayment,
  "id" | "createdAt" | "updatedAt"
> & { id?: ID; createdAt?: number; updatedAt?: number };

export interface QuarterlyPaymentStatus {
  quarter: TaxQuarter;
  estimatedDue: number;
  paid: number;
  remaining: number;
  overdue: boolean;
}

/**
 * Per-quarter status: estimated due (quarterlyPayment each), paid (from
 * recorded TaxPayments for the jurisdiction), remaining, overdue flag.
 */
export function quarterlyPaymentStatus(
  taxYear: number,
  quarterlyPayment: number,
  payments: TaxPayment[],
  jurisdiction: TaxJurisdiction,
  nowMs: number,
): QuarterlyPaymentStatus[] {
  return quarterlyDueDates(taxYear).map((quarter) => {
    const paid = payments
      .filter(
        (p) =>
          p.taxYear === taxYear &&
          p.quarter === quarter.quarter &&
          p.jurisdiction === jurisdiction,
      )
      .reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, quarterlyPayment - paid);
    return {
      quarter,
      estimatedDue: quarterlyPayment,
      paid: round2(paid),
      remaining: round2(remaining),
      overdue: quarter.dueDate < nowMs && remaining > 0,
    };
  });
}

/** Set-aside tracker: reserved vs. target vs. paid. */
export interface SetAsideStatus {
  target: number;
  /** Paid estimated taxes reduce what still needs reserving. */
  paid: number;
  /** Target minus paid (floored at 0). */
  stillToReserve: number;
  /** 0..1+ funding ratio (null when target is 0). */
  fundedRatio: number | null;
}

export function setAsideStatus(
  target: number,
  paidTotal: number,
): SetAsideStatus {
  const stillToReserve = Math.max(0, target - paidTotal);
  return {
    target: round2(target),
    paid: round2(paidTotal),
    stillToReserve: round2(stillToReserve),
    fundedRatio: target > 0 ? paidTotal / target : null,
  };
}