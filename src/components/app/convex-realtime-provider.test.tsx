// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { notifyDataChanged } from "@/lib/data/data-events";
import { ConvexRealtimeProvider } from "./convex-realtime-provider";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
const state = vi.hoisted(() => ({ userId: "owner", sessionId: "session-1", fail: false }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => state }));
vi.mock("convex/react", () => ({
  ConvexReactClient: class { close = vi.fn(); },
  useAction: () => refresh,
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: () => { if (state.fail) throw new Error("workspace:revision server error"); return 1; },
}));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/data/data-events", () => ({ notifyDataChanged: vi.fn() }));
afterEach(() => { cleanup(); state.fail = false; state.sessionId = "session-1"; vi.restoreAllMocks(); vi.clearAllMocks(); });

it("keeps the app and login usable when the optional revision query throws, and retries after a session change", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.fail = true;
  const view = render(<ConvexRealtimeProvider url="https://example.convex.cloud"><div>App remains usable</div></ConvexRealtimeProvider>);
  expect(screen.getByText("App remains usable")).toBeTruthy();
  state.fail = false;
  state.sessionId = "session-2";
  view.rerender(<ConvexRealtimeProvider url="https://example.convex.cloud"><div>App remains usable</div></ConvexRealtimeProvider>);
  expect(screen.getByText("App remains usable")).toBeTruthy();
  expect(notifyDataChanged).toHaveBeenCalled();
});

it("refreshes admission before subscribing, and keeps content usable if verification fails", async () => {
  refresh.mockRejectedValueOnce(new Error("Verification unavailable"));
  const view = render(<ConvexRealtimeProvider url="https://example.convex.cloud" admissionEnabled><div>Workspace</div></ConvexRealtimeProvider>);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByText("Workspace")).toBeTruthy();
  refresh.mockResolvedValue({ allowed: true, expiresAt: Date.now() + 60000 });
  state.sessionId = "session-2";
  view.rerender(<ConvexRealtimeProvider url="https://example.convex.cloud" admissionEnabled><div>Workspace</div></ConvexRealtimeProvider>);
  await waitFor(() => expect(notifyDataChanged).toHaveBeenCalled());
});
