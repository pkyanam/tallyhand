// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LandingChoiceScreen } from "./landing-choice";
import { LANDING_CHOICE_KEY } from "@/lib/landing";
vi.mock("@/components/app/brand-mark", () => ({ BrandMark: () => null }));
const replace = vi.fn();
const values = new Map<string, string>();
const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), clear: () => values.clear(), removeItem: (k: string) => values.delete(k) };
const actualWindow = window;
afterEach(() => { cleanup(); storage.clear(); vi.unstubAllGlobals(); replace.mockClear(); });
function setup(choice?: string) {
  if (choice) storage.setItem(LANDING_CHOICE_KEY, choice);
  vi.stubGlobal("window", new Proxy(actualWindow, { get(target, key) { return key === "localStorage" ? storage : key === "location" ? { replace, assign: vi.fn() } : Reflect.get(target, key); } }));
}
it("shows both choices when signed out despite a remembered cloud choice", () => {
  setup("cloud");
  render(<LandingChoiceScreen />);
  expect(screen.getByRole("button", { name: /Sign in/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Use locally/ })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
it("shows both choices on a first visit", () => {
  setup(); render(<LandingChoiceScreen />);
  expect(screen.getByRole("button", { name: /Use locally/ })).toBeTruthy();
});
it("resumes an explicitly selected local workspace", () => {
  setup("local"); render(<LandingChoiceScreen />);
  expect(replace).toHaveBeenCalledWith("/dashboard");
});
it("sends an active session to its workspace even without a saved choice", () => {
  setup(); render(<LandingChoiceScreen signedIn />);
  expect(replace).toHaveBeenCalledWith("/dashboard");
});
