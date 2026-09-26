import { describe, expect, it } from "vitest";
import {
  annualizeProfit,
  DEFAULT_TAX_CONFIG,
  estimateAnnualTax,
  federalIncomeTax,
  FEDERAL_BRACKETS_2025_SINGLE,
  nextQuarterDue,
  quarterlyDueDates,
  quarterlyPaymentStatus,
  selfEmploymentTax,
  setAsideStatus,
  type TaxPayment,
} from "./tax";

const NOW = Date.UTC(2026, 8, 26);

describe("selfEmploymentTax", () => {
  it("is 15.3% of 92.35% of profit below the SS cap", () => {
    // 100_000 * 0.9235 = 92_350; all under the cap.
    const expected = 92_350 * 0.124 + 92_350 * 0.029;
    expect(selfEmploymentTax(100_000)).toBeCloseTo(expected, 2);
  });

  it("caps the Social Security portion at the wage base", () => {
    // 300k profit → base 277_050; SS applies only to first 176_100.
    const expected = 176_100 * 0.124 + 277_050 * 0.029;
    expect(selfEmploymentTax(300_000)).toBeCloseTo(expected, 2);
  });

  it("is zero for non-positive profit", () => {
    expect(selfEmploymentTax(0)).toBe(0);
    expect(selfEmploymentTax(-5000)).toBe(0);
  });
});

describe("federalIncomeTax", () => {
  it("applies marginal brackets", () => {
    // 50k taxable: 10%×11,925 + 12%×(48,475−11,925) + 22%×(50,000−48,475)
    const expected =
      11_925 * 0.1 + (48_475 - 11_925) * 0.12 + (50_000 - 48_475) * 0.22;
    expect(federalIncomeTax(50_000, FEDERAL_BRACKETS_2025_SINGLE)).toBeCloseTo(
      expected,
      2,
    );
  });

  it("is zero for non-positive income", () => {
    expect(federalIncomeTax(0, FEDERAL_BRACKETS_2025_SINGLE)).toBe(0);
  });
});

describe("estimateAnnualTax", () => {
  it("combines SE tax and income tax on a realistic contractor profit", () => {
    const est = estimateAnnualTax(80_000);
    // SE tax on 80k: base 73_880 → 73_880 × 15.3%
    expect(est.selfEmploymentTax).toBeCloseTo(73_880 * 0.153, 0);
    // Taxable: 80k − SE/2 − 15k standard deduction
    const taxable = 80_000 - est.selfEmploymentTax / 2 - 15_000;
    expect(est.taxableIncome).toBeCloseTo(taxable, 0);
    expect(est.federalIncomeTax).toBeGreaterThan(0);
    expect(est.totalTax).toBeCloseTo(
      est.selfEmploymentTax + est.federalIncomeTax,
      2,
    );
    expect(est.quarterlyPayment).toBeCloseTo(est.totalTax / 4, 2);
    expect(est.effectiveRate).toBeCloseTo(est.totalTax / 80_000, 4);
  });

  it("returns zeros for zero profit", () => {
    const est = estimateAnnualTax(0);
    expect(est.totalTax).toBe(0);
    expect(est.quarterlyPayment).toBe(0);
    expect(est.effectiveRate).toBeNull();
  });

  it("computes the set-aside target from the configured percent", () => {
    const est = estimateAnnualTax(100_000, {
      ...DEFAULT_TAX_CONFIG,
      setAsidePercent: 0.3,
    });
    expect(est.setAsideTarget).toBe(30_000);
  });
});

describe("annualizeProfit", () => {
  it("scales YTD profit to a full year", () => {
    expect(annualizeProfit(30_000, 6)).toBe(60_000);
  });

  it("clamps months to [1, 12]", () => {
    expect(annualizeProfit(30_000, 0)).toBe(360_000);
    expect(annualizeProfit(120_000, 24)).toBe(120_000);
  });
});

describe("quarterlyDueDates / nextQuarterDue", () => {
  it("returns the four federal due dates", () => {
    const dates = quarterlyDueDates(2026).map((q) => q.dueDate);
    expect(dates).toEqual([
      Date.UTC(2026, 3, 15),
      Date.UTC(2026, 5, 15),
      Date.UTC(2026, 8, 15),
      Date.UTC(2027, 0, 15),
    ]);
  });

  it("finds the next due quarter", () => {
    // Sep 26 2026 → Q3 (Sep 15) has passed, next is Q4 (Jan 15 2027).
    const next = nextQuarterDue(2026, NOW);
    expect(next?.quarter).toBe(4);
    expect(next?.dueDate).toBe(Date.UTC(2027, 0, 15));
  });

  it("returns null once the year's quarters are all past", () => {
    expect(nextQuarterDue(2026, Date.UTC(2027, 5, 1))).toBeNull();
  });
});

describe("quarterlyPaymentStatus", () => {
  const payment = (overrides: Partial<TaxPayment> = {}): TaxPayment => ({
    id: "txp_1",
    taxYear: 2026,
    quarter: 1,
    date: Date.UTC(2026, 3, 10),
    amount: 1000,
    jurisdiction: "federal",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  it("tracks paid vs remaining per quarter and flags overdue", () => {
    const payments = [
      payment({ quarter: 1, amount: 1000 }),
      payment({ quarter: 1, amount: 500 }),
      payment({ quarter: 2, amount: 1500, jurisdiction: "state" }), // different jurisdiction
    ];
    const status = quarterlyPaymentStatus(2026, 1500, payments, "federal", NOW);
    const q1 = status[0];
    expect(q1.paid).toBe(1500);
    expect(q1.remaining).toBe(0);
    expect(q1.overdue).toBe(false);
    const q2 = status[1];
    expect(q2.paid).toBe(0);
    expect(q2.remaining).toBe(1500);
    expect(q2.overdue).toBe(true); // Jun 15 < Sep 26
    const q4 = status[3];
    expect(q4.overdue).toBe(false); // not due yet
  });
});

describe("setAsideStatus", () => {
  it("computes the funding ratio and remaining reserve", () => {
    const s = setAsideStatus(30_000, 12_000);
    expect(s.stillToReserve).toBe(18_000);
    expect(s.fundedRatio).toBeCloseTo(0.4, 4);
  });

  it("floors the remainder at zero and handles a zero target", () => {
    expect(setAsideStatus(10_000, 12_000).stillToReserve).toBe(0);
    expect(setAsideStatus(0, 0).fundedRatio).toBeNull();
  });
});
