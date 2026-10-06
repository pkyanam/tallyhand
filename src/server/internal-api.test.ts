import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { health } = vi.hoisted(() => ({ health: vi.fn(async () => Response.json({ data: { status: "ok" } })) }));
vi.mock("@/app/api/v1/health/route", () => ({ GET: health }));
vi.mock("@/app/api/v1/tasks/bulk/route", () => ({ POST: async () => Response.json({ data: "bulk" }) }));
vi.mock("@/app/api/v1/onboarding/route", () => ({ GET: async () => Response.json({ data: { ready: false } }), POST: async (request: Request) => Response.json({ data: { received: await request.json() } }) }));
vi.mock("@/app/api/v1/changes/route", () => ({ GET: async () => Response.json({ data: { revision: 3 } }) }));
vi.mock("@/app/api/v1/requests/[key]/route", () => ({ GET: async (_request: Request, context: { params: { key: string } }) => Response.json({ data: { key: context.params.key } }) }));
import { dispatchWorkspaceApi } from "./internal-api";
beforeEach(() => { vi.stubEnv("APP_BASE_URL", "https://tally.example"); health.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
it("uses the same registered route handler without an HTTP loopback", async () => {
  const response = await dispatchWorkspaceApi("https://tally.example/api/v1/health");
  expect((await response.json()).data.status).toBe("ok"); expect(health).toHaveBeenCalledOnce();
});
it("has no arbitrary external destination or administrative route", async () => {
  await expect(dispatchWorkspaceApi("https://other.example/api/v1/health")).rejects.toThrow("not allowed");
  expect((await dispatchWorkspaceApi("https://tally.example/api/admin/users")).status).toBe(404);
});

it("matches literal bulk routes before entity IDs", async () => {
  const response = await dispatchWorkspaceApi("https://tally.example/api/v1/tasks/bulk", { method: "POST" });
  expect((await response.json()).data).toBe("bulk");
});

it("supports setup status and validated configuration through the local adapter", async () => {
  const status = await dispatchWorkspaceApi("https://tally.example/api/v1/onboarding");
  expect((await status.json()).data).toEqual({ ready: false });
  const setup = await dispatchWorkspaceApi("https://tally.example/api/v1/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { business: { name: "Studio" } }, dryRun: true }) });
  expect((await setup.json()).data.received.dryRun).toBe(true);
});

it("routes recovery reads and preserves the request key parameter", async () => {
  const changes = await dispatchWorkspaceApi("https://tally.example/api/v1/changes");
  expect((await changes.json()).data.revision).toBe(3);
  const receipt = await dispatchWorkspaceApi("https://tally.example/api/v1/requests/stable-key");
  expect((await receipt.json()).data.key).toBe("stable-key");
});
