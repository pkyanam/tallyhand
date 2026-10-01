import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { health } = vi.hoisted(() => ({ health: vi.fn(async () => Response.json({ data: { status: "ok" } })) }));
vi.mock("@/app/api/v1/health/route", () => ({ GET: health }));
vi.mock("@/app/api/v1/tasks/bulk/route", () => ({ POST: async () => Response.json({ data: "bulk" }) }));
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
