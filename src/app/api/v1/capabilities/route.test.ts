import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { makeRequest, setupApiEnv, teardownApiEnv } from "../_tests/helpers";
const auth = vi.hoisted(() => ({ oauth: false, role: "member", scopes: ["tally:read"] }));
vi.mock("@/server/auth", () => ({ requireApiToken: async (req: Request) => req.headers.has("authorization") ? null : new Response(null, { status: 401 }) }));
vi.mock("@/lib/auth/oauth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/auth/oauth")>(), isOAuthToken: () => auth.oauth, verifyTallyOAuth: async () => ({ scopes: auth.scopes }) }));
vi.mock("@/lib/auth/session", () => ({ resolveUserId: async () => "user_test" }));
vi.mock("@/lib/auth/users", () => ({ getUserRole: async () => auth.role }));
vi.mock("@/lib/mode", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/mode")>(), effectiveAuth: () => "builtin" }));
describe("capabilities authorization", () => {
  let db: string;
  beforeEach(() => { db = setupApiEnv(); auth.oauth = false; auth.role = "member"; auth.scopes = ["tally:read"]; });
  afterEach(() => teardownApiEnv(db));
  it("reports actual OAuth scopes without advertising session administration", async () => {
    auth.oauth = true;
    const data = (await (await GET(makeRequest("/api/v1/capabilities", { headers: { authorization: "Bearer oat_test" } }, false))).json()).data;
    expect(data.caller).toMatchObject({ authentication: "oauth", scopes: ["tally:read"], canWriteWorkspace: false });
    expect(data.operations.filter((op: { requiredScope: string }) => op.requiredScope === "tally:write").every((op: { allowedNow: boolean }) => !op.allowedNow)).toBe(true);
    expect(data.operations.find((op: { path: string }) => op.path === "/api/v1/dunning/run")).toMatchObject({ allowedNow: false, dryRunAllowedNow: true, dryRunRequiredScope: "tally:read" });
    expect(data.operations.some((op: { requiredScope: string; allowedNow: boolean }) => op.requiredScope === "tally:read" && op.allowedNow)).toBe(true);
    expect(data.operations.filter((op: { requiredScope: string }) => op.requiredScope === "session").every((op: { allowedNow: boolean }) => !op.allowedNow)).toBe(true);
  });
  it("viewer API tokens remain read-only and unauthenticated requests are denied", async () => {
    auth.role = "viewer";
    const data = (await (await GET(makeRequest("/api/v1/capabilities"))).json()).data;
    expect(data.caller.canWriteWorkspace).toBe(false);
    expect(data.operations.filter((op: { method: string }) => op.method !== "GET" && op.method !== "HEAD").every((op: { allowedNow: boolean }) => !op.allowedNow)).toBe(true);
    expect((await GET(makeRequest("/api/v1/capabilities", {}, false))).status).toBe(401);
  });
});
