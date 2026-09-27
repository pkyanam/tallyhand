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
});
