// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
const state = vi.hoisted(() => ({ path: "/", refresh: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "user_test" }), useClerk: () => ({ signOut: state.signOut }) }));
vi.mock("convex/react", () => ({ ConvexReactClient: class { close() {} }, useConvexAuth: () => ({ isAuthenticated: true }), useQuery: () => undefined, useAction: () => state.refresh }));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: ({ children }: { children: ReactNode }) => children }));
import { AdmissionNotice } from "./admission-notice";
import { ConvexRealtimeProvider } from "./convex-realtime-provider";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("native admission recovery", () => {
  it("offers native sign-out without exposing private identity or errors", async () => {
    state.signOut.mockResolvedValue(undefined);
    render(<AdmissionNotice reason="clearance_denied" />);
    expect(screen.getByText(/does not have agentsub clearance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out and switch accounts" }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledWith({ redirectUrl: "/login" }));
    expect(screen.getByRole("link", { name: "Return to Tallyhand home" }).getAttribute("href")).toBe("/");
  });
  it.each(["/", "/login", "/login/agentid", "/docs", "/share/public", "/privacy"])("does not trap signed-in users on public %s", async path => {
    state.path = path;
    render(<ConvexRealtimeProvider url="https://test.convex.cloud" admissionEnabled><p>Public content</p></ConvexRealtimeProvider>);
    expect(screen.getByText("Public content")).toBeTruthy();
    expect(state.refresh).not.toHaveBeenCalled();
  });
  it("keeps denied workspace data gated with actionable recovery", async () => {
    state.path = "/reckoning"; state.refresh.mockResolvedValue({ allowed: false, expiresAt: 0, reason: "clearance_denied" });
    render(<ConvexRealtimeProvider url="https://test.convex.cloud" admissionEnabled><p>Protected workspace data</p></ConvexRealtimeProvider>);
    await screen.findByRole("button", { name: "Sign out and switch accounts" });
    expect(screen.queryByText("Protected workspace data")).toBeNull();
  });
});
