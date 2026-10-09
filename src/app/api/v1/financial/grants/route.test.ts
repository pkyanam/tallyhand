import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/auth/session", () => ({ requireSessionUserId: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ getUserRole: vi.fn() }));
vi.mock("@/lib/auth/api-tokens", () => ({ listApiTokens: vi.fn() }));
vi.mock("@/lib/financial/grants", () => ({
  createFinancialGrant: vi.fn(),
  listFinancialGrants: vi.fn(),
  revokeFinancialGrant: vi.fn(),
}));
import { requireSessionUserId } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/users";
import { listApiTokens } from "@/lib/auth/api-tokens";
import {
  createFinancialGrant,
  revokeFinancialGrant,
} from "@/lib/financial/grants";
import { POST, DELETE } from "./route";
const body = {
  workspaceId: "u",
  principal: { kind: "api-token", tokenId: "t" },
  actions: ["collect"],
  accountId: "acct",
  mode: "test",
  currency: "USD",
  maxMinorUnits: 100,
};
const request = (data: unknown) =>
  new Request("http://test/api/v1/financial/grants", {
    method: "POST",
    body: JSON.stringify(data),
  });
describe("session grant management", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireSessionUserId).mockResolvedValue("u");
    vi.mocked(getUserRole).mockResolvedValue("member");
    vi.mocked(listApiTokens).mockResolvedValue([
      {
        id: "t",
        userId: "u",
        name: "Agent",
        prefix: "thp_1234",
        createdAt: 1,
        lastUsedAt: null,
      },
    ]);
  });
  it("creates explicit authority for an owned token", async () => {
    expect((await POST(request(body))).status).toBe(201);
    expect(createFinancialGrant).toHaveBeenCalledWith({ ...body, userId: "u" });
  });
  it("rejects machine authentication when no interactive session exists", async () => {
    vi.mocked(requireSessionUserId).mockRejectedValue(
      Object.assign(new Error("No session"), { status: 401 }),
    );
    expect((await POST(request(body))).status).toBe(401);
    expect(createFinancialGrant).not.toHaveBeenCalled();
  });
  it("rejects a foreign token or workspace and viewers", async () => {
    vi.mocked(listApiTokens).mockResolvedValue([]);
    expect((await POST(request(body))).status).toBe(403);
    expect(
      (await POST(request({ ...body, workspaceId: "foreign" }))).status,
    ).toBe(403);
    vi.mocked(getUserRole).mockResolvedValue("viewer");
    expect(
      (await DELETE(new Request("http://test/?id=g", { method: "DELETE" })))
        .status,
    ).toBe(403);
    expect(revokeFinancialGrant).not.toHaveBeenCalled();
  });
});
