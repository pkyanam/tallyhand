// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Invoice } from "@/lib/db/types";
import { InvoiceSharePanel } from "./invoice-share-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const invoice: Invoice = {
  id: "qa-invoice", clientId: "qa-client", invoiceNumber: "QA-1",
  issueDate: 0, dueDate: 0, status: "draft", lineItems: [],
  subtotal: 0, total: 0, createdAt: 0, updatedAt: 0,
  publicToken: "synthetic-qa-token",
};

describe("invoice sharing availability", () => {
  it("does not promise public sharing for a browser-local invoice", () => {
    render(<InvoiceSharePanel invoice={invoice} readOnly={false} dirty={false} cloudSharingEnabled={false} />);
    expect(screen.getByText("This browser only")).toBeTruthy();
    expect(screen.queryByText("Anyone with the link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create cloud link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download shareable file" })).toBeTruthy();
  });
  it("loads the existing link without a click and disables it", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { shareUrl: "https://example.test/share/fixture", cloudLinkEnabled: true } }))
      .mockResolvedValueOnce(Response.json({ data: { shareUrl: null, cloudLinkEnabled: false } }));
    vi.stubGlobal("fetch", fetcher);
    render(<InvoiceSharePanel invoice={invoice} readOnly={false} dirty={false} cloudSharingEnabled />);
    await waitFor(() => expect(screen.getByText("https://example.test/share/fixture")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Disable cloud link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable cloud link" })).toBeTruthy());
    expect(fetcher.mock.calls[1][1].body).toBe(JSON.stringify({ enabled: false }));
  });
  it("does not automatically re-enable a disabled invoice", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { cloudLinkEnabled: false, shareUrl: null } }));
    vi.stubGlobal("fetch", fetcher);
    render(<InvoiceSharePanel invoice={invoice} readOnly={false} dirty={false} cloudSharingEnabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable cloud link" })).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
