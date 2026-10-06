import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { makeRequest, setupApiEnv, teardownApiEnv } from "../_tests/helpers";
import { getServerProvider } from "@/server/provider";

describe("agent onboarding", () => {
  let db: string;
  beforeEach(() => { db = setupApiEnv(); });
  afterEach(() => teardownApiEnv(db));
  it("time tracking is ready without inventing invoice setup blockers", async () => {
    const data = (await (await GET(makeRequest("/api/v1/onboarding"))).json()).data;
    expect(data.ready).toBe(true);
    expect(data.readinessByIntent.invoicing).toBe(false);
    expect(data.missingConfiguration[0]).toMatchObject({ field: "business.name", blocking: false });
  });
  it("invoice intent returns actionable seller setup and existing defaults", async () => {
    const data = (await (await GET(makeRequest("/api/v1/onboarding?intent=invoicing"))).json()).data;
    expect(data.ready).toBe(false);
    expect(data.nextSteps[0]).toMatchObject({ method: "POST", path: "/api/v1/onboarding", requiresInput: ["business.name"] });
    expect(data.defaults.currency).toBe("USD");
  });
  it("validates without mutating on dry run and applies persisted settings idempotently", async () => {
    const body = { settings: { business: { name: "Actual Studio" } }, intent: "invoicing" };
    const dry = await POST(makeRequest("/api/v1/onboarding", { method: "POST", body: JSON.stringify({ ...body, dryRun: true }), headers: { "Idempotency-Key": "configure" } }));
    expect((await dry.json()).data.dryRun).toBe(true);
    expect((await getServerProvider().getSettings()).business.name).toBe("");
    const response = await POST(makeRequest("/api/v1/onboarding", { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": "configure" } }));
    expect((await response.json()).data.ready).toBe(true);
    await POST(makeRequest("/api/v1/onboarding", { method: "POST", body: JSON.stringify({ settings: { business: { name: "Changed" } } }), headers: { "Idempotency-Key": "configure" } }));
    expect((await getServerProvider().getSettings()).business.name).toBe("Actual Studio");
  });
  it("rejects invalid input, unknown intent, and missing credentials", async () => {
    expect((await GET(makeRequest("/api/v1/onboarding?intent=unknown"))).status).toBe(400);
    expect((await GET(makeRequest("/api/v1/onboarding", {}, false))).status).toBe(401);
    expect((await POST(makeRequest("/api/v1/onboarding", { method: "POST", body: JSON.stringify({ settings: { secret: true }, dryRun: true }) }))).status).toBe(400);
  });
});
