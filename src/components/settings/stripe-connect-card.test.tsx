// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/lib/db/repos", () => ({ clientRepo: {}, invoiceRepo: {}, settingsRepo: {} }));
import { StripeConnectCard } from "./dunning-tax-cards";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Stripe Connect settings status", () => {
  it("shows unavailable capability without a broken connection button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { connected: false, supported: false, message: "Stripe Connect is not available with Convex storage yet." } })));
    render(<StripeConnectCard />);
    expect(await screen.findByText("Stripe Connect is not available with Convex storage yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect with Stripe" })).toBeNull();
  });
  it("lets users retry a status failure instead of loading forever", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: { connected: false, supported: true } }));
    vi.stubGlobal("fetch", fetcher);
    render(<StripeConnectCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry Stripe status" }));
    expect(await screen.findByRole("button", { name: "Connect with Stripe" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
