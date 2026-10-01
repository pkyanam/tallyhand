import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@clerk/backend", () => ({ createClerkClient: () => ({ idPOAuthAccessToken: { verify } }) }));
import { verifyTallyOAuth, requiredRestScope, oauthConfig } from "./oauth";

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://tally.example");
  vi.stubEnv("TALLY_OAUTH_ISSUER", "https://clerk.tally.example");
  vi.stubEnv("TALLY_MCP_OAUTH_ENABLED", "true");
  vi.stubEnv("CLERK_SECRET_KEY", "synthetic-test-value");
  verify.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
const fixture = () => ({ subject: "user_fixture", clientId: "client_fixture", scopes: ["tally:read"], revoked: false, expired: false, expiration: Date.now()/1000 + 600, aud: ["https://tally.example/api/mcp"] });
describe("resource-bound Clerk OAuth", () => {
  it("uses the configured instance and exact audience", async () => {
    verify.mockResolvedValue(fixture());
    expect(await verifyTallyOAuth("oat_synthetic_fixture")).toMatchObject({ userId: "user_fixture", scopes: ["tally:read"] });
    expect(verify).toHaveBeenCalledWith("oat_synthetic_fixture", { audience: "https://tally.example/api/mcp" });
  });
  it.each([{ aud: undefined }, { aud: ["https://elsewhere.example"] }, { revoked: true }, { expired: true }, { subject: "org_fixture" }, { expiration: 1 }])("rejects invalid token properties %j", async patch => {
    verify.mockResolvedValue({ ...fixture(), ...patch });
    expect(await verifyTallyOAuth("oat_synthetic_fixture")).toBeNull();
  });
  it("does not enable OAuth until explicitly configured", async () => {
    vi.stubEnv("TALLY_MCP_OAUTH_ENABLED", "false");
    expect(oauthConfig().enabled).toBe(false);
    expect(await verifyTallyOAuth("oat_synthetic_fixture")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
  it("limits scopes to workspace APIs", () => {
    expect(requiredRestScope(new Request("https://tally.example/api/admin/users"))).toBeNull();
    expect(requiredRestScope(new Request("https://tally.example/api/v1/settings"))).toBe("tally:read");
    expect(requiredRestScope(new Request("https://tally.example/api/v1/settings", { method: "PATCH" }))).toBe("tally:write");
    expect(requiredRestScope(new Request("https://tally.example/api/v1/data", { method: "POST" }))).toBe("tally:manage");
  });
});

it("does not misreport temporary provider failure as an invalid token", async () => {
  verify.mockRejectedValue({ status: 503 });
  await expect(verifyTallyOAuth("oat_synthetic_fixture")).rejects.toThrow("temporarily unavailable");
});
it("still rejects a provider-rejected token", async () => {
  verify.mockRejectedValue({ status: 401 });
  expect(await verifyTallyOAuth("oat_synthetic_fixture")).toBeNull();
});
