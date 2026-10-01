// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setStorageProvider, getStorageProvider } from "@/lib/db/repos";
import { restStorageProvider } from "./rest-storage-provider";
import { notifyDataChanged } from "./data-events";
import { useLiveQuery } from "./use-live-query";

describe("useLiveQuery with REST provider", () => {
  const original = getStorageProvider();
  afterEach(() => { setStorageProvider(original); vi.restoreAllMocks(); });

  it("fetches initially and again after data changes", async () => {
    setStorageProvider(restStorageProvider);
    const querier = vi.fn().mockResolvedValueOnce(["first"]).mockResolvedValue(["updated"]);
    const { result } = renderHook(() => useLiveQuery(querier, []));
    await waitFor(() => expect(result.current).toEqual(["first"]));
    act(() => notifyDataChanged());
    await waitFor(() => expect(result.current).toEqual(["updated"]));
    expect(querier).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a fresh result when an earlier request finishes late", async () => {
    setStorageProvider(restStorageProvider);
    let finishOld!: (value: string[]) => void;
    const oldRequest = new Promise<string[]>((resolve) => { finishOld = resolve; });
    const querier = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValue(["fresh"]);
    const { result } = renderHook(() => useLiveQuery(querier, []));
    await waitFor(() => expect(querier).toHaveBeenCalledTimes(1));
    act(() => notifyDataChanged());
    await waitFor(() => expect(result.current).toEqual(["fresh"]));
    await act(async () => { finishOld(["stale"]); await oldRequest; });
    expect(result.current).toEqual(["fresh"]);
  });
});
