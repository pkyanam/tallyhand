// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  getSyncStatus: vi.fn(),
  ensureDataKey: vi.fn(),
  setSyncEnabled: vi.fn((enabled: boolean) => {
    mocks.enabled = enabled;
  }),
  runSync: vi.fn(),
  installDeleteHooks: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  getSyncStatus: mocks.getSyncStatus,
  ensureDataKey: mocks.ensureDataKey,
  isSyncEnabled: vi.fn(() => mocks.enabled),
  setSyncEnabled: mocks.setSyncEnabled,
  runSync: mocks.runSync,
}));

vi.mock("@/lib/sync/delete-hooks", () => ({
  installDeleteHooks: mocks.installDeleteHooks,
}));

import { SyncBootstrap } from "./sync-bootstrap";

describe("SyncBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.enabled = false;
    mocks.ensureDataKey.mockResolvedValue({});
    mocks.runSync.mockResolvedValue({ status: "ok" });
    mocks.getSyncStatus.mockResolvedValue({
      signedIn: true,
      syncSupported: true,
      userId: "user_1",
      storage: "neon",
    });
  });

  afterEach(cleanup);

  it("auto-enables and starts sync for a signed-in Neon user", async () => {
    render(React.createElement(SyncBootstrap));

    await waitFor(() => expect(mocks.runSync).toHaveBeenCalledOnce());
    expect(mocks.ensureDataKey).toHaveBeenCalledWith("user_1");
    expect(mocks.setSyncEnabled).toHaveBeenCalledWith(true, "user_1");
    expect(mocks.installDeleteHooks).toHaveBeenCalled();
  });

  it("runs sync on later app loads and rebinds metadata to the current account", async () => {
    mocks.enabled = true;
    mocks.getSyncStatus.mockResolvedValue({
      signedIn: true,
      syncSupported: true,
      userId: "user_2",
      storage: "neon",
    });

    render(React.createElement(SyncBootstrap));

    await waitFor(() => expect(mocks.runSync).toHaveBeenCalledOnce());
    expect(mocks.setSyncEnabled).toHaveBeenCalledWith(true, "user_2");
  });
});
