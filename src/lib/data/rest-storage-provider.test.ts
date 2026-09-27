import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotSupportedError, RestStorageProvider } from "./rest-storage-provider";

describe("RestStorageProvider", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("follows list cursors and uses same-origin credentials on every request", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "a", archived: false }], meta: { nextCursor: "next value" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "b", archived: false }], meta: { nextCursor: null } }), { status: 200 }));
    const rows = await new RestStorageProvider().listClients();
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ credentials: "same-origin" });
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=next%20value");
  });

  it("sends the sync header on writes", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "c1" } }), { status: 201 }));
    await new RestStorageProvider().createClient({ name: "Client" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-tallyhand-sync": "1" },
    });
  });

  it("treats extension 501 list as empty and write as unsupported", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 501 }));
    await expect(new RestStorageProvider().listMileageEntries()).resolves.toEqual([]);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 501 }));
    await expect(new RestStorageProvider().createMileageEntry({
      date: Date.now(), miles: 1, purpose: "mock", rate: 0.67,
    })).rejects.toBeInstanceOf(NotSupportedError);
  });
});
