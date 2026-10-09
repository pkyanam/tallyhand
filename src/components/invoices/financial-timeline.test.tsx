// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FinancialTimeline } from "./financial-timeline";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps pending and failed refunds distinct from confirmed collection and manual evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {
    attempts: [], payments: [{ id: "p", money: { currency: "USD", minorUnits: 10000 } }],
    allocations: [], refunds: [
      { id: "r1", state: "pending", money: { currency: "USD", minorUnits: 2000 } },
      { id: "r2", state: "failed", money: { currency: "USD", minorUnits: 3000 } },
    ], manualEvidence: [{ id: "m", money: { currency: "USD", minorUnits: 5000 }, note: "Bank transfer reported" }], audit: { items: [] },
  } })));
  render(<FinancialTimeline invoiceId="invoice-1" />);
  await waitFor(() => expect(screen.getByText(/Stripe collection confirmed:/)).toBeTruthy());
  expect(screen.getByText(/Refund pending:.*not deducted/)).toBeTruthy();
  expect(screen.getByText(/Refund failed:.*not deducted/)).toBeTruthy();
  expect(screen.getByText(/Manual payment evidence:.*Bank transfer reported/)).toBeTruthy();
  expect(screen.getByText(/not your bank balance/)).toBeTruthy();
});

it("shows unavailable authority instead of presenting empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Financial authority denied" } }, { status: 403 })));
  render(<FinancialTimeline invoiceId="invoice-1" />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Financial authority denied"));
  expect(screen.queryByText("No financial records yet.")).toBeNull();
});

it("labels historical paid status as unknown provenance instead of empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { attempts: [], payments: [], refunds: [], manualEvidence: [], audit: { items: [] } } })));
  render(<FinancialTimeline invoiceId="legacy" invoiceStatus="paid" />);
  await screen.findByText(/Legacy paid status: payment provenance is unknown/);
  expect(screen.queryByText("No financial records yet.")).toBeNull();
});

it("shows a manual invoice projection in its original currency without manufacturing a provider record", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { attempts: [], payments: [], refunds: [], manualEvidence: [], audit: { items: [] }, invoiceStatus: "paid", manualAssertion: { source: "manual", actorId: "owner", recordedAt: 1, currency: "EUR", total: 12 } } })));
  render(<FinancialTimeline invoiceId="manual" invoiceStatus="paid" />);
  await screen.findByText(/Manually marked paid: €12.00.*recorded by owner/);
  expect(screen.queryByText(/Stripe collection confirmed:/)).toBeNull();
  expect(screen.queryByText("No financial records yet.")).toBeNull();
});

it("reloads provenance when the mounted invoice is marked paid", async () => {
  const empty = { attempts: [], payments: [], refunds: [], manualEvidence: [], audit: { items: [] } };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { ...empty, invoiceStatus: "sent" } }))
    .mockResolvedValueOnce(Response.json({ data: { ...empty, invoiceStatus: "paid", manualAssertion: { source: "manual", actorId: "owner", recordedAt: 1, total: 12, currency: "EUR" } } }));
  vi.stubGlobal("fetch", fetcher);
  const { rerender } = render(<FinancialTimeline invoiceId="invoice" invoiceStatus="sent" />);
  await screen.findByText("No financial records yet.");
  rerender(<FinancialTimeline invoiceId="invoice" invoiceStatus="paid" />);
  await screen.findByText(/Manually marked paid: €12.00/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
