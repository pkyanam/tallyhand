// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Invoice } from "@/lib/db/types";
import { InvoiceSharePanel } from "./invoice-share-panel";

afterEach(cleanup);
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
  it("offers server-backed links only when cloud sharing is available", () => {
    render(<InvoiceSharePanel invoice={invoice} readOnly={false} dirty={false} cloudSharingEnabled />);
    expect(screen.getByRole("button", { name: "Create cloud link" })).toBeTruthy();
    expect(screen.queryByText("This browser only")).toBeNull();
  });
});
