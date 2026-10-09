import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/auth/api-tokens", () => ({ findApiTokenUncached: vi.fn() }));
vi.mock("@/lib/auth/oauth", () => ({
  isOAuthToken: () => false,
  verifyTallyOAuthUncached: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSessionUserId: vi.fn() }));
vi.mock("@/lib/mode", () => ({ effectiveAuth: () => "builtin" }));
vi.mock("@/lib/auth/users", () => ({
  getUserRole: vi.fn(async () => "member"),
}));
vi.mock("@/lib/share/service", () => ({ resolveShareToken: vi.fn() }));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: () => ({}) }));
vi.mock("@/lib/financial/grants", async () => ({
  ...(await import("@/core/financial/authority")),
  getFinancialGrant: vi.fn(),
}));
import { findApiTokenUncached } from "@/lib/auth/api-tokens";
import { getFinancialGrant } from "@/lib/financial/grants";
import { requireSessionUserId } from "@/lib/auth/session";
import {
  authorizeFinancial,
  resolveFinancialRequestAuthority,
} from "./financial-authority";
const scope = {
  userId: "u",
  workspaceId: "u",
  provider: "stripe" as const,
  accountId: "a",
  mode: "test" as const,
};
describe("financial authorization", () => {
  beforeEach(() => vi.resetAllMocks());
  it("does not give existing API keys automatic execute authority", async () => {
    vi.mocked(findApiTokenUncached).mockResolvedValue({
      id: "t",
      userId: "u",
      name: "agent",
    });
    await expect(
      resolveFinancialRequestAuthority(
        new Request("http://test", {
          headers: { authorization: "Bearer thp_existing" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      authorizeFinancial(
        "collect",
        { kind: "api-token", token: "thp_existing", grantId: "missing" },
        scope,
        { invoiceId: "i", money: { currency: "USD", minorUnits: 100 } },
      ),
    ).rejects.toThrow();
  });
  it("rechecks token revocation rather than trusting a granted identity", async () => {
    vi.mocked(findApiTokenUncached).mockResolvedValue(null);
    await expect(
      authorizeFinancial(
        "read",
        { kind: "api-token", token: "revoked", grantId: "g" },
        scope,
      ),
    ).rejects.toThrow();
    expect(getFinancialGrant).not.toHaveBeenCalled();
  });
  it("checks actual session ownership", async () => {
    vi.mocked(requireSessionUserId).mockResolvedValue("other");
    await expect(
      authorizeFinancial("collect", { kind: "owner", userId: "u" }, scope),
    ).rejects.toThrow();
  });
  it("customer capabilities cannot read financial workspace records", async () => {
    await expect(
      authorizeFinancial(
        "read",
        { kind: "customer", shareToken: "cap" },
        scope,
      ),
    ).rejects.toThrow();
  });
});
