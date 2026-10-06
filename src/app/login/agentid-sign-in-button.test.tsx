// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentIdSignInButton } from "./agentid-sign-in-button";

const state = vi.hoisted(() => ({ redirect: vi.fn(), pathname: "/login", loaded: true }));
vi.mock("@clerk/nextjs", () => ({ useSignIn: () => ({ isLoaded: state.loaded, signIn: { authenticateWithRedirect: state.redirect } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
afterEach(cleanup);
beforeEach(() => { state.redirect.mockReset(); state.pathname = "/login"; state.loaded = true; });

describe("AgentID sign-in", () => {
  it("uses Clerk's callback and preserves the requested destination", async () => {
    render(<AgentIdSignInButton redirectUrlComplete="/settings/connect" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(state.redirect).toHaveBeenCalledWith({ strategy: "oauth_agentid", redirectUrl: "/login/sso-callback", redirectUrlComplete: "/settings/connect" }));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
  it("allows retry after a failed redirect", async () => {
    state.redirect.mockRejectedValue(new Error("unavailable"));
    render(<AgentIdSignInButton redirectUrlComplete="/" />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
  it("leaves OAuth callbacks to Clerk", () => {
    state.pathname = "/login/sso-callback";
    render(<AgentIdSignInButton redirectUrlComplete="/" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
