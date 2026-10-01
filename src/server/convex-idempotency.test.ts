import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { owner, mutation, transport } = vi.hoisted(() => ({ owner: vi.fn(), mutation: vi.fn(), transport: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ tryResolveUserId: owner }));
vi.mock("@/lib/db/convex-client", () => ({ createConvexRequestClient: transport }));
import { withConvexIdempotency } from "./convex-idempotency";
const request = () => new Request("https://app.test/api/v1/invoices", { method: "POST", body: '{"clientId":"client"}' });
beforeEach(() => { vi.resetAllMocks(); owner.mockResolvedValue("owner"); transport.mockReturnValue({ mutation }); });
afterEach(() => vi.unstubAllEnvs());
describe("Convex idempotent API writes", () => {
  it("records the successful response and leaves the original request body readable", async () => {
    mutation.mockResolvedValueOnce({ state: "claimed" }).mockResolvedValueOnce(null);
    const req = request();
    const handler = vi.fn(async () => { expect(await req.json()).toEqual({ clientId: "client" }); return Response.json({ id: "invoice" }, { status: 201 }); });
    expect((await withConvexIdempotency(req, "key", handler)).status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenLastCalledWith("idempotency:complete", expect.objectContaining({ status: 201, body: '{"id":"invoice"}' }));
  });
  it.each(["pending", "conflict"])("does not reexecute a %s request", async (state) => {
    mutation.mockResolvedValueOnce({ state }); const handler = vi.fn();
    expect((await withConvexIdempotency(request(), "key", handler)).status).toBe(409);
    expect(handler).not.toHaveBeenCalled();
  });
  it("replays an empty 204 response", async () => {
    mutation.mockResolvedValueOnce({ state: "complete", status: 204, body: "" }); const handler = vi.fn();
    const result = await withConvexIdempotency(request(), "key", handler);
    expect(result.status).toBe(204); expect(result.headers.get("Idempotency-Replayed")).toBe("true");
    expect(handler).not.toHaveBeenCalled();
  });
  it("does not start an operation when the deployment is unconfigured", async () => {
    transport.mockImplementationOnce(() => { throw new Error("Missing configuration"); }); const handler = vi.fn();
    expect((await withConvexIdempotency(request(), "key", handler)).status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });
  it("reports uncertainty when the write succeeds but saving its receipt fails", async () => {
    mutation.mockResolvedValueOnce({ state: "claimed" }).mockRejectedValueOnce(new Error("Disconnected"));
    const handler = vi.fn(async () => Response.json({ id: "invoice" }));
    const result = await withConvexIdempotency(request(), "key", handler);
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: "IDEMPOTENCY_UNCERTAIN" } });
    expect(handler).toHaveBeenCalledOnce();
  });
});
