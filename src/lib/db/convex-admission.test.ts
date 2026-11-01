/// <reference types="vite/client" />
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const refresh = makeFunctionReference<"action">("admission:refresh");
const list = makeFunctionReference<"query">("tally:clientsList");
const create = makeFunctionReference<"mutation">("tally:clientsCreate");
let linked = true, allowed = true;
beforeEach(() => {
  linked = true; allowed = true;
  vi.stubEnv("AGENTSUB_MERCHANT_ID", "merchant-test"); vi.stubEnv("AGENTSUB_OFFER_ID", "offer-test"); vi.stubEnv("AGENTSUB_MERCHANT_KEY", "key-test"); vi.stubEnv("CLERK_SECRET_KEY", "clerk-test");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/users/") ? { id: "user_test", external_accounts: linked ? [{ provider: "oauth_agentid", provider_user_id: "upstream-test", verification: { status: "verified" } }] : [] } : { merchantId: "merchant-test", offerId: "offer-test", allowed, priceUc: "0", paymentRequired: false, agentIdentity: { issuer: "https://auth.agentid.com", subject: "upstream-test" } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("direct native Convex admission", () => {
  it("requires trusted refresh, preserves ownership and permits full native CRUD", async () => {
    const base = convexTest(schema, modules);
    const caller = base.withIdentity({ subject: "user_test", role: "member" });
    await expect(caller.query(list, { userId: "user_test" })).rejects.toThrow("Refresh application admission");
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: true });
    await caller.mutation(create, { userId: "user_test", id: "client", name: "Native client" });
    expect(await caller.query(list, { userId: "user_test" })).toHaveLength(1);
    await expect(caller.query(list, { userId: "other" })).rejects.toThrow("Owner mismatch");
    await expect(base.withIdentity({ subject: "user_other" }).query(list, { userId: "user_test" })).rejects.toThrow();
    await base.run(async ctx => { const row = await ctx.db.query("applicationAdmissions").first(); await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }); });
    await expect(caller.query(list, { userId: "user_test" })).rejects.toThrow();
  });
  it("denies revocation refresh and historical agent unlink instead of granting human access", async () => {
    const caller = convexTest(schema, modules).withIdentity({ subject: "user_test" });
    await caller.action(refresh, {}); allowed = false;
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: false });
    await expect(caller.query(list, { userId: "user_test" })).rejects.toThrow();
    linked = false;
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: false });
  });
  it("reports an unregistered native agent as denied and preserves agent classification", async () => {
    vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/users/")
      ? { id: "user_test", external_accounts: [{ provider: "oauth_agentid", provider_user_id: "upstream-test", verification: { status: "verified" } }] }
      : { code: "NOT_FOUND" }, String(url).includes("/users/") ? undefined : { status: 404 }));
    const base = convexTest(schema, modules), caller = base.withIdentity({ subject: "user_test" });
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: false, reason: "clearance_denied" });
    expect(await base.run(ctx => ctx.db.query("applicationAdmissions").first())).toMatchObject({ kind: "agent", allowed: false });
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "user_test", external_accounts: [] }));
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: false, reason: "clearance_denied" });
  });
  it("reports canonical frozen/cap policy denial without granting access", async () => {
    vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/users/")
      ? { id: "user_test", external_accounts: [{ provider: "oauth_agentid", provider_user_id: "upstream-test", verification: { status: "verified" } }] }
      : { code: "CAP_EXCEEDED" }, String(url).includes("/users/") ? undefined : { status: 403 }));
    const base = convexTest(schema, modules), caller = base.withIdentity({ subject: "user_test" });
    expect(await caller.action(refresh, {})).toMatchObject({ allowed: false, reason: "clearance_denied" });
    await expect(caller.query(list, { userId: "user_test" })).rejects.toThrow();
  });
  it.each([{ status: 503, code: "provider_unavailable" }, { status: 403, code: "scope_required" }, { status: 403, code: "SCOPE_REQUIRED" }, { status: 401, code: "unauthorized" }])("keeps service and credential failures unavailable: %j", async problem => {
    vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/users/")
      ? { id: "user_test", external_accounts: [{ provider: "oauth_agentid", provider_user_id: "upstream-test", verification: { status: "verified" } }] }
      : { code: problem.code }, String(url).includes("/users/") ? undefined : { status: problem.status }));
    const caller = convexTest(schema, modules).withIdentity({ subject: "user_test" });
    await expect(caller.action(refresh, {})).rejects.toThrow("could not be verified");
  });
  it("expires stored grants on schedule without browser refresh", async () => {
    vi.useFakeTimers();
    const base = convexTest(schema, modules), caller = base.withIdentity({ subject: "user_test" });
    await caller.action(refresh, {});
    await base.finishAllScheduledFunctions(() => vi.runAllTimers());
    const row = await base.run(ctx => ctx.db.query("applicationAdmissions").first());
    expect(row?.allowed).toBe(false);
    await expect(caller.query(list, { userId: "user_test" })).rejects.toThrow();
  });
  it("requires the native server bridge secret and rechecks live decisions", async () => {
    const base = convexTest(schema, modules);
    const bridge = makeFunctionReference<"action">("admission:refreshBridge");
    const serverSecret = "test-native-server-bridge-secret-123456789";
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", serverSecret);
    await expect(base.action(bridge, { userId: "user_test", serverSecret: "wrong" })).rejects.toThrow("Server authorization");
    expect(await base.action(bridge, { userId: "user_test", serverSecret })).toMatchObject({ allowed: true });
    allowed = false;
    expect(await base.action(bridge, { userId: "user_test", serverSecret })).toMatchObject({ allowed: false });
  });
  it("preserves human ACLs with supported custom JWTs without session claims", async () => {
    linked = false;
    const base = convexTest(schema, modules), human = base.withIdentity({ subject: "user_test", role: "viewer" });
    expect(await human.action(refresh, {})).toMatchObject({ allowed: true });
    expect(await human.query(list, { userId: "user_test" })).toEqual([]);
    await expect(human.mutation(create, { userId: "user_test", id: "x", name: "x" })).rejects.toThrow("Viewers have read-only");
    expect(await base.withIdentity({ subject: "user_test" }).action(refresh, {})).toMatchObject({ allowed: true });
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("/sessions/"))).toBe(true);
    await expect(base.withIdentity({ subject: "user_other" }).action(refresh, {})).rejects.toThrow("could not be verified");
  });
});
