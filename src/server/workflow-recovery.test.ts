import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const { auth, owner, storage, query } = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), storage: vi.fn(), query: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireApiToken: auth }));
vi.mock("@/lib/auth/session", () => ({ tryResolveUserId: owner }));
vi.mock("@/lib/mode", () => ({ parseStorage: storage }));
vi.mock("@/lib/db/convex-client", () => ({ createConvexRequestClient: () => ({ query }) }));
import { GET as changes } from "@/app/api/v1/changes/route";
import { GET as receipt } from "@/app/api/v1/requests/[key]/route";
const req = (path: string) => new Request(`https://app.test/api/v1/${path}`);
beforeEach(() => { vi.resetAllMocks(); auth.mockResolvedValue(null); owner.mockResolvedValue("owner-a"); storage.mockReturnValue("convex"); });
describe("workflow recovery", () => {
  it("polls only the authenticated owner's revision and validates the marker", async () => {
    query.mockResolvedValue(7);
    const response = await changes(req("changes?since=7"));
    expect(await response.json()).toEqual({ data: { available: true, revision: 7, changed: false, pollAfterMs: 2000 } });
    expect(query).toHaveBeenCalledWith("workspace:revision", { userId: "owner-a" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await changes(req("changes?since=-1"))).status).toBe(400);
  });
  it("uses exactly the write claim namespace and marks pending as reconciliation", async () => {
    query.mockResolvedValue({ state: "pending", status: null, createdAt: 123 });
    const response = await receipt(req("requests/key"), { params: { key: "key" } });
    expect(query).toHaveBeenCalledWith("idempotency:status", { key: createHash("sha256").update(JSON.stringify(["owner-a", "key"])).digest("hex") });
    expect(await response.json()).toEqual({ data: { state: "pending", status: null, createdAt: 123, requiresReconciliation: true } });
    owner.mockResolvedValue("owner-b");
    await receipt(req("requests/key"), { params: { key: "key" } });
    expect(query.mock.calls[0][1].key).not.toBe(query.mock.calls[1][1].key);
  });
  it("reports absent, unavailable, and unsupported receipts explicitly", async () => {
    query.mockResolvedValue(null);
    expect((await receipt(req("requests/key"), { params: { key: "key" } })).status).toBe(404);
    query.mockRejectedValue(new Error("secret provider detail"));
    const unavailable = await receipt(req("requests/key"), { params: { key: "key" } });
    expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("secret provider detail");
    storage.mockReturnValue("sqlite"); query.mockClear();
    expect((await changes(req("changes"))).status).toBe(501); expect(query).not.toHaveBeenCalled();
  });
  it("requires authentication before querying", async () => {
    auth.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await changes(req("changes"))).status).toBe(401);
    expect((await receipt(req("requests/key"), { params: { key: "key" } })).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
