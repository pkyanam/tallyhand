import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/server/financial-worker", () => ({
  runFinancialRecoveryBatch: m.run,
}));
import { GET } from "./route";
const request = (key?: string) =>
  new Request("https://app.test/api/internal/financial/recover", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-secret");
  m.run.mockResolvedValue({ examined: 1 });
});
describe("scheduled recovery authentication", () => {
  it("denies missing/wrong authentication before any recovery access", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
  });
  it("fails closed when not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("cron-secret"))).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
  });
  it("runs authenticated batches and suppresses raw secret-bearing errors", async () => {
    expect((await GET(request("cron-secret"))).status).toBe(200);
    m.run.mockRejectedValueOnce(new Error("database-secret"));
    const result = await GET(request("cron-secret"));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("database-secret");
  });
});
