import { beforeEach, it, expect, vi } from "vitest";
const fixture = vi.hoisted(() => ({ userId: "owner-a", revoke: vi.fn(), approvals: vi.fn(async () => []), link: { id: "fixture", userId: "owner-b" } }));
vi.mock("@/server/auth", () => ({ requireApiToken: async () => null }));
vi.mock("@/lib/auth/session", () => ({ resolveUserId: async () => fixture.userId }));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: () => ({ ownerProvider: { getShareLinkById: async () => fixture.link, revokeShareLink: fixture.revoke, listTimesheetApprovalsByLink: fixture.approvals } }) }));
import { DELETE } from "./[id]/route";
import { GET } from "./[id]/approvals/route";
beforeEach(() => { fixture.userId = "owner-a"; fixture.revoke.mockClear(); fixture.approvals.mockClear(); });
it("only exposes or revokes shares owned by the authenticated workspace", async () => {
  const req = new Request("https://fixture.example/api/v1/share-links/fixture");
  expect((await DELETE(req, { params: { id: "fixture" } })).status).toBe(404);
  expect((await GET(req, { params: { id: "fixture" } })).status).toBe(404);
  expect(fixture.revoke).not.toHaveBeenCalled(); expect(fixture.approvals).not.toHaveBeenCalled();
});
it("allows the owner to read approvals", async () => {
  fixture.userId = "owner-b";
  expect((await GET(new Request("https://fixture.example/api/v1/share-links/fixture/approvals"), { params: { id: "fixture" } })).status).toBe(200);
  expect(fixture.approvals).toHaveBeenCalledWith("fixture");
});
