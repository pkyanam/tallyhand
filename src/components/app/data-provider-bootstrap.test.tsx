// @vitest-environment jsdom
import { useEffect, StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DataProviderBootstrap } from "./data-provider-bootstrap";
const state = vi.hoisted(() => ({ mode: "cloud", provider: "local", reads: [] as string[] }));
vi.mock("./app-chrome-provider", () => ({ useAppChrome: () => ({ dataMode: state.mode }) }));
vi.mock("@/lib/db/repos", () => ({ getStorageProvider: () => state.provider, setStorageProvider: (p: string) => { state.provider = p; } }));
vi.mock("@/lib/db/dexie-provider", () => ({ dexieStorageProvider: "local" }));
vi.mock("@/lib/data/rest-storage-provider", () => ({ restStorageProvider: "cloud" }));
vi.mock("@/lib/data/data-events", () => ({ notifyDataChanged: vi.fn() }));
function Reader() { useEffect(() => { state.reads.push(state.provider); }, []); return <div>Workspace loaded</div>; }
afterEach(() => { cleanup(); state.mode = "cloud"; state.provider = "local"; state.reads = []; });
it("selects cloud before any workspace reader mounts, including StrictMode replay", () => {
  render(<StrictMode><DataProviderBootstrap><Reader /></DataProviderBootstrap></StrictMode>);
  expect(screen.getByText("Workspace loaded")).toBeTruthy();
  expect(state.reads.length).toBeGreaterThan(0);
  expect(state.reads.every(p => p === "cloud")).toBe(true);
});
it("remounts readers against local storage when switching modes", () => {
  const view = render(<DataProviderBootstrap><Reader /></DataProviderBootstrap>);
  state.mode = "local";
  view.rerender(<DataProviderBootstrap><Reader /></DataProviderBootstrap>);
  expect(state.reads).toEqual(["cloud", "local"]);
});
