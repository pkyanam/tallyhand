/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const claim = makeFunctionReference<"mutation">("idempotency:claim");
const complete = makeFunctionReference<"mutation">("idempotency:complete");
const serverSecret = "synthetic-local-test-secret-only-123456789";
afterEach(() => vi.unstubAllEnvs());
describe("Convex durable request receipts", () => {
  it("claims once, keeps pending operations locked, and replays saved responses", async () => {
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", serverSecret);
    const t = convexTest(schema, modules);
    const args = { key: "scoped-key", fingerprint: "request", claimId: "first", serverSecret };
    expect(await t.mutation(claim, args)).toEqual({ state: "claimed" });
    expect(await t.mutation(claim, { ...args, claimId: "retry" })).toEqual({ state: "pending" });
    await t.mutation(complete, { key: args.key, claimId: args.claimId, serverSecret, status: 201, body: '{"id":"invoice"}', contentType: "application/json" });
    expect(await t.mutation(claim, { ...args, claimId: "retry" })).toEqual({ state: "complete", status: 201, body: '{"id":"invoice"}', contentType: "application/json" });
    expect(await t.mutation(claim, { ...args, fingerprint: "different-request" })).toEqual({ state: "conflict" });
  });
});
