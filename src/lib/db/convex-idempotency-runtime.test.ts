/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const claim = makeFunctionReference<"mutation">("idempotency:claim");
const status = makeFunctionReference<"query">("idempotency:status");
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
    expect(await t.query(status, { key: args.key, serverSecret })).toMatchObject({ state: "pending", status: null });
    expect(await t.query(status, { key: "other-owner-key", serverSecret })).toBeNull();
    await expect(t.query(status, { key: args.key, serverSecret: "invalid" })).rejects.toThrow();
    await t.mutation(complete, { key: args.key, claimId: args.claimId, serverSecret, status: 201, body: '{"id":"invoice"}', contentType: "application/json" });
    expect(await t.mutation(claim, { ...args, claimId: "retry" })).toEqual({ state: "complete", status: 201, body: '{"id":"invoice"}', contentType: "application/json" });
    const metadata = await t.query(status, { key: args.key, serverSecret });
    expect(metadata).toMatchObject({ state: "complete", status: 201 });
    expect(metadata).not.toHaveProperty("body");
    expect(metadata).not.toHaveProperty("claimId");
    expect(await t.mutation(claim, { ...args, fingerprint: "different-request" })).toEqual({ state: "conflict" });
  });
});
