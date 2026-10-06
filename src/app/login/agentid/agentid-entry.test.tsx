// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentIdEntry } from "./agentid-entry";
const state = vi.hoisted(() => ({ loaded: true, available: true, redirect: vi.fn(), choice: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useSignIn: () => ({ isLoaded: state.loaded, signIn: state.available ? { authenticateWithRedirect: state.redirect } : undefined }), useAuth: () => ({ isLoaded: state.loaded, isSignedIn: false }) }));
vi.mock("@/app/landing-choice",()=>({writeLandingChoice:state.choice}));
afterEach(cleanup);
beforeEach(() => { state.loaded=true; state.available=true; state.choice.mockReset(); state.redirect.mockReset(); state.redirect.mockResolvedValue(undefined); });
describe("automatic AgentID entry", () => {
  it("starts AgentID automatically once and preserves the OAuth continuation", async () => {
    const next="/login/oauth/continue?authorization_url=canonical";
    const view=render(<AgentIdEntry next={next} />);
    await waitFor(()=>expect(state.redirect).toHaveBeenCalledWith({ strategy:"oauth_agentid",redirectUrl:`/login/sso-callback?next=${encodeURIComponent(next)}`,redirectUrlComplete:next }));
    expect(state.choice).toHaveBeenCalledWith("cloud");
    expect(state.choice.mock.invocationCallOrder[0]).toBeLessThan(state.redirect.mock.invocationCallOrder[0]);
    view.rerender(<AgentIdEntry next={next} />); expect(state.redirect).toHaveBeenCalledTimes(1);
  });
  it("keeps the current workspace when Clerk cannot start sign-in",async()=>{
    state.available=false;render(<AgentIdEntry next="/dashboard" />);await screen.findByRole("alert");expect(state.choice).not.toHaveBeenCalled();expect(state.redirect).not.toHaveBeenCalled();
  });
  it("waits for Clerk and offers a safe sign-in fallback after failure", async () => {
    state.loaded=false; const view=render(<AgentIdEntry next="/settings/connect" />); expect(state.redirect).not.toHaveBeenCalled(); expect(state.choice).not.toHaveBeenCalled();
    state.redirect.mockRejectedValue(new Error("secret provider details")); state.loaded=true; view.rerender(<AgentIdEntry next="/settings/connect" />);
    await screen.findByRole("alert"); expect(screen.getByRole("link").getAttribute("href")).toBe("/login?next=%2Fsettings%2Fconnect"); expect(document.body.textContent).not.toContain("secret");
  });
});
