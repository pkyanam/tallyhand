import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareDeps } from "@/lib/share/service";

const { mockResolveUserId, mockGetShareDeps } = vi.hoisted(() => ({
  mockResolveUserId: vi.fn(),
  mockGetShareDeps: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveUserId: mockResolveUserId,
}));
vi.mock("@/lib/share/server-deps", () => ({
  getShareDeps: mockGetShareDeps,
}));

import { GET, POST } from "./route";

const SECRET = "test-server-secret-32-chars-minimum!!";

function request(body: unknown): Request {
  return new Request("https://tally.example.com/api/share/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invoiceShareBody() {
  return {
    type: "invoice",
    target: {
      invoiceId: "inv-1",
      snapshot: {
        invoice: {
          id: "inv-1",
          invoiceNumber: "INV-001",
          clientId: "client-1",
        },
        client: { id: "client-1", name: "Acme" },
      },
    },
    expiresInDays: 30,
  };
}

describe("/api/share/links", () => {
  const createShareLink = vi.fn();
  const listShareLinks = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveUserId.mockResolvedValue("user-1");
    createShareLink.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "link-1",
      userId: "user-1",
      createdAt: Date.now(),
      revokedAt: null,
      ...input,
    }));
    listShareLinks.mockResolvedValue([]);
    mockGetShareDeps.mockReturnValue({
      ownerProvider: { createShareLink, listShareLinks, getInvoice: async () => undefined },
      providerForUser: vi.fn(),
      shareSecret: SECRET,
      baseUrl: "https://tally.example.com",
    } as unknown as ShareDeps);
  });

  it("creates an authenticated hosted invoice link", async () => {
    const response = await POST(request(invoiceShareBody()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string; token: string };
    expect(body.url).toMatch(/^https:\/\/tally\.example\.com\/share\//);
    expect(body.token.length).toBeGreaterThan(20);
    expect(createShareLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invoice",
        target: expect.objectContaining({ invoiceId: "inv-1" }),
      }),
    );
  });

  it("rejects requests without a signed-in session", async () => {
    mockResolveUserId.mockRejectedValueOnce(new Error("Not signed in"));
    const response = await POST(request(invoiceShareBody()));
    expect(response.status).toBe(401);
    expect(mockGetShareDeps).not.toHaveBeenCalled();
  });

  it("preserves provider authorization errors", async () => {
    const denied = Object.assign(new Error("Viewers have read-only access"), {
      status: 403,
    });
    createShareLink.mockRejectedValueOnce(denied);
    const response = await POST(request(invoiceShareBody()));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Viewers have read-only access",
    });
  });

  it("lists only through the authenticated owner provider", async () => {
    listShareLinks.mockResolvedValueOnce([{ id: "link-1", userId: "user-1" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      links: [{ id: "link-1", userId: "user-1" }],
    });
  });
});
