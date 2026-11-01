import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@clerk/backend", () => ({ createClerkClient: () => ({ users: { getUser } }) }));
import { requireAgentSubAdmission } from "./agentsub";
import { withRequestAuthCache } from "./request-cache";
const account = { provider: "oauth_agentid", providerUserId: "upstream-test-subject", verification: { status: "verified" } };
const grant = { merchantId: "test-merchant", offerId: "test-offer", agentIdentity: { issuer: "https://auth.agentid.com", subject: account.providerUserId }, allowed: true, paymentRequired: false, priceUc: "0" };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("AGENTSUB_MERCHANT_ID", "test-merchant"); vi.stubEnv("AGENTSUB_OFFER_ID", "test-offer");
  vi.stubEnv("AGENTSUB_MERCHANT_KEY", "test-server-key"); vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
  getUser.mockReset().mockResolvedValue({ id: "user_test", externalAccounts: [account] });
  fetcher = vi.fn().mockImplementation(async () => Response.json(grant)); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("native merchant admission", () => {
  it("uses only the linked upstream subject and pins the endpoint", async () => {
    await requireAgentSubAdmission("user_test");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.agentsub.dev/v1/access/merchant-check");
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer test-server-key" } });
    expect(JSON.parse(options.body)).toEqual({ offerId: grant.offerId, agentIdentity: grant.agentIdentity });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([{ merchantId: "other" }, { offerId: "other" }, { allowed: false }, { paymentRequired: true }, { priceUc: 1 }, { priceUc: 0 }, { agentIdentity: { ...grant.agentIdentity, subject: "user_test" } }, { agentIdentity: { ...grant.agentIdentity, issuer: "https://elsewhere.test" } }])("rejects mismatched or paid decisions %j", async patch => {
    fetcher.mockResolvedValue(Response.json({ ...grant, ...patch }));
    await expect(requireAgentSubAdmission("user_test")).rejects.toThrow("could not be verified");
  });
  it.each([[], [{ ...account, providerUserId: "" }], [account, account], [{ ...account, verification: { status: "unverified" } }]].map(accounts => [accounts]))("preserves humans and rejects ambiguous agent links %j", async accounts => {
    getUser.mockResolvedValue({ id: "user_test", externalAccounts: accounts });
    if (!accounts.length) await requireAgentSubAdmission("user_test");
    else await expect(requireAgentSubAdmission("user_test")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("coalesces concurrent checks within a request and rechecks revoked access next request", async () => {
    await withRequestAuthCache(() => Promise.all(Array.from({ length: 20 }, () => requireAgentSubAdmission("user_test"))));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(Response.json({ ...grant, allowed: false }));
    await expect(withRequestAuthCache(() => requireAgentSubAdmission("user_test"))).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("fails closed on network failure or incomplete configuration without exposing errors", async () => {
    fetcher.mockRejectedValue(new Error("private upstream details"));
    await expect(requireAgentSubAdmission("user_test")).rejects.toThrow("Agent subscription access could not be verified");
    vi.stubEnv("AGENTSUB_MERCHANT_KEY", "");
    await expect(requireAgentSubAdmission("user_test")).rejects.toThrow();
  });
  it("leaves unconfigured deployments untouched", async () => {
    for (const name of ["AGENTSUB_MERCHANT_ID", "AGENTSUB_OFFER_ID", "AGENTSUB_MERCHANT_KEY"]) vi.stubEnv(name, "");
    await requireAgentSubAdmission("user_test"); expect(getUser).not.toHaveBeenCalled();
  });
});
