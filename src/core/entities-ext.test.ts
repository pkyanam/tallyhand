import { describe, expect, it } from "vitest";
import {
  mileageDeduction,
  mileageRateForDate,
  totalMileageDeduction,
  totalMiles,
  DEFAULT_MILEAGE_RATE,
  type MileageEntry,
} from "./mileage";
import {
  contractsNeedingAttention,
  contractStatus,
  CONTRACT_TYPE_LABELS,
  type Contract,
} from "./contracts";
import {
  activeRateCards,
  resolveRate,
  type RateCard,
} from "./rate-cards";

const NOW = Date.UTC(2026, 8, 26);
const DAY = 86_400_000;

function mileage(overrides: Partial<MileageEntry> = {}): MileageEntry {
  return {
    id: "mil_1",
    date: NOW,
    miles: 100,
    rate: 0.7,
    purpose: "Client site visit",
    isBilled: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("mileage", () => {
  it("computes the deduction per entry", () => {
    expect(mileageDeduction(mileage())).toBe(70);
    expect(mileageDeduction(mileage({ miles: 33.3, rate: 0.7 }))).toBe(23.31);
  });

  it("totals deductions and miles", () => {
    const entries = [mileage(), mileage({ id: "mil_2", miles: 50 })];
    expect(totalMileageDeduction(entries)).toBe(105);
    expect(totalMiles(entries)).toBe(150);
  });

  it("looks up the IRS rate by year with a fallback", () => {
    expect(mileageRateForDate(Date.UTC(2025, 5, 1))).toBe(0.7);
    expect(mileageRateForDate(Date.UTC(2024, 5, 1))).toBe(0.67);
    expect(mileageRateForDate(Date.UTC(2030, 5, 1))).toBe(DEFAULT_MILEAGE_RATE);
  });
});

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "ctr_1",
    clientId: "cli_1",
    type: "sow",
    title: "Website redesign SOW",
    startDate: NOW - 100 * DAY,
    renewalNoticeDays: 30,
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("contracts", () => {
  it("labels contract types", () => {
    expect(CONTRACT_TYPE_LABELS.msa).toContain("Master services");
  });

  it("is active mid-term", () => {
    const info = contractStatus(
      contract({ endDate: NOW + 90 * DAY }),
      NOW,
    );
    expect(info).toEqual({ status: "active", daysUntilExpiry: 90 });
  });

  it("warns inside the renewal window", () => {
    const info = contractStatus(
      contract({ endDate: NOW + 10 * DAY, renewalNoticeDays: 30 }),
      NOW,
    );
    expect(info.status).toBe("expiring");
    expect(info.daysUntilExpiry).toBe(10);
  });

  it("flags expired contracts", () => {
    const info = contractStatus(contract({ endDate: NOW - 5 * DAY }), NOW);
    expect(info.status).toBe("expired");
    expect(info.daysUntilExpiry).toBe(-5);
  });

  it("treats open-ended contracts as active", () => {
    expect(contractStatus(contract(), NOW).status).toBe("active");
    expect(contractStatus(contract(), NOW).daysUntilExpiry).toBeNull();
  });

  it("marks future contracts upcoming", () => {
    const info = contractStatus(
      contract({ startDate: NOW + 10 * DAY, endDate: NOW + 100 * DAY }),
      NOW,
    );
    expect(info.status).toBe("upcoming");
  });

  it("collects contracts needing attention, most urgent first", () => {
    const list = [
      contract({ id: "ok", endDate: NOW + 200 * DAY }),
      contract({ id: "expiring", endDate: NOW + 5 * DAY }),
      contract({ id: "expired", endDate: NOW - 2 * DAY }),
      contract({ id: "archived", endDate: NOW - 2 * DAY, archived: true }),
    ];
    const attention = contractsNeedingAttention(list, NOW);
    expect(attention.map((a) => a.contract.id)).toEqual([
      "expired",
      "expiring",
    ]);
  });
});

function rateCard(overrides: Partial<RateCard> = {}): RateCard {
  return {
    id: "rc_1",
    clientId: "cli_1",
    name: "Standard",
    defaultRate: 150,
    lines: [],
    effectiveFrom: NOW - 365 * DAY,
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("rate-cards", () => {
  it("prefers the project rate override above everything", () => {
    expect(
      resolveRate(
        [rateCard({ lines: [{ id: "l1", label: "Dev", rate: 200 }] })],
        {
          clientId: "cli_1",
          projectId: "prj_1",
          lineLabel: "Dev",
          projectRateOverride: 175,
        },
        NOW,
      ),
    ).toBe(175);
  });

  it("matches project card lines before client card lines", () => {
    const cards = [
      rateCard({
        id: "client-card",
        lines: [{ id: "l1", label: "Dev", rate: 150 }],
      }),
      rateCard({
        id: "project-card",
        projectId: "prj_1",
        lines: [{ id: "l2", label: "Dev", rate: 200 }],
      }),
    ];
    expect(
      resolveRate(cards, { clientId: "cli_1", projectId: "prj_1", lineLabel: "Dev" }, NOW),
    ).toBe(200);
    expect(
      resolveRate(cards, { clientId: "cli_1", projectId: "prj_9", lineLabel: "Dev" }, NOW),
    ).toBe(150);
  });

  it("falls back through card default to client default", () => {
    const cards = [rateCard()];
    expect(
      resolveRate(cards, { clientId: "cli_1", projectId: "prj_1", lineLabel: "Nope" }, NOW),
    ).toBe(150);
    expect(
      resolveRate([], { clientId: "cli_1", clientDefaultRate: 120 }, NOW),
    ).toBe(120);
    expect(resolveRate([], { clientId: "cli_1" }, NOW)).toBeUndefined();
  });

  it("ignores future, ended, and archived cards", () => {
    const cards = [
      rateCard({ id: "future", effectiveFrom: NOW + DAY }),
      rateCard({ id: "ended", effectiveTo: NOW - DAY }),
      rateCard({ id: "archived", archived: true }),
    ];
    expect(
      resolveRate(cards, { clientId: "cli_1", clientDefaultRate: 99 }, NOW),
    ).toBe(99);
    expect(activeRateCards(cards, "cli_1", NOW)).toEqual([]);
  });

  it("matches line labels case-insensitively", () => {
    const cards = [
      rateCard({ lines: [{ id: "l1", label: "Backend Dev", rate: 180 }] }),
    ];
    expect(
      resolveRate(cards, { clientId: "cli_1", lineLabel: "backend dev" }, NOW),
    ).toBe(180);
  });
});
