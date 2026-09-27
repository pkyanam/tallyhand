// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppChromeProvider } from "@/components/app/app-chrome-provider";
import { ContractsSection } from "./contracts-section";
import { RateCardsSection } from "./rate-cards-section";
import { MileageSection } from "@/components/expenses/mileage-section";

vi.mock("@/lib/data/use-live-query", () => ({
  useLiveQuery: () => [],
}));

function view(dataMode: "cloud" | "local", section: React.ReactNode) {
  return <AppChromeProvider dataMode={dataMode}>{section}</AppChromeProvider>;
}

describe("data sections remain hook-safe as the signed-in data mode flips", () => {
  it.each([
    ["contracts", () => <ContractsSection clientId="client-1" projects={[]} />],
    ["rate cards", () => <RateCardsSection clientId="client-1" projects={[]} />],
    ["mileage", () => <MileageSection />],
  ] as const)("%s survives user → signed out → user", (_name, section) => {
    const signedInMode = "local" as const;
    const signedOutMode = "cloud" as const;
    const result = render(view(signedInMode, section()));
    expect(() => result.rerender(view(signedOutMode, section()))).not.toThrow();
    expect(() => result.rerender(view(signedInMode, section()))).not.toThrow();
  });
});
