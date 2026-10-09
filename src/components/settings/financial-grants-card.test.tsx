// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  FinancialGrantsCard,
  amountToMinorUnits,
} from "./financial-grants-card";
const grant = {
  id: "grant-1",
  userId: "u",
  workspaceId: "u",
  principal: { kind: "api-token", tokenId: "token-1" },
  actions: ["collect"],
  accountId: "acct_1",
  mode: "test",
  currency: "USD",
  maxMinorUnits: 10000,
  createdAt: 1,
  revokedAt: null,
};
function setup(grants: unknown[] = []) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) return new Response(null, { status: 503 });
    if (url.includes("api-tokens"))
      return Response.json({ data: [{ id: "token-1", name: "My agent" }] });
    if (url.includes("connect/status"))
      return Response.json({
        data: { connected: true, accountId: "acct_1", livemode: false },
      });
    return Response.json({ data: grants });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("agent payment permission controls", () => {
  it("converts only exact safe amounts", () => {
    expect(amountToMinorUnits("123.45")).toBe(12345);
    expect(amountToMinorUnits("0")).toBe(0);
    expect(amountToMinorUnits("1.001")).toBeNull();
    expect(amountToMinorUnits("-1")).toBeNull();
    expect(amountToMinorUnits("9007199254740991.00")).toBeNull();
  });
  it("requires an explicit owner choice and never fabricates a grant after failure", async () => {
    const fetcher = setup();
    render(<FinancialGrantsCard />);
    const submit = await screen.findByRole("button", {
      name: "Grant payment permission",
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher.mock.calls.every((c) => !c[1])).toBe(true);
    fireEvent.change(screen.getByLabelText("Agent token"), {
      target: { value: "token-1" },
    });
    fireEvent.click(screen.getByLabelText("Collect invoice payments"));
    fireEvent.change(screen.getByLabelText("Maximum per collection"), {
      target: { value: "100.001" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Maximum per collection"), {
      target: { value: "100.00" },
    });
    fireEvent.click(submit);
    await screen.findByRole("alert");
    expect(
      screen.queryByText(
        "Payment permission created. Copy its ID for your agent.",
      ),
    ).toBeNull();
    const post = fetcher.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      principal: { kind: "api-token", tokenId: "token-1" },
      actions: ["collect"],
      accountId: "acct_1",
      mode: "test",
      currency: "USD",
      maxMinorUnits: 10000,
    });
  });
  it("retains an active grant when revocation fails", async () => {
    setup([grant]);
    render(<FinancialGrantsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await screen.findByText(
      "Could not revoke this permission. It may still be active. Try again.",
    );
    expect(screen.queryByText("Revoked")).toBeNull();
    expect(screen.getByText("grant-1")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Revoke" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
