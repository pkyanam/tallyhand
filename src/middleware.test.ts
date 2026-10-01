import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFetchEvent, NextRequest } from "next/server";
import middleware from "./middleware";

const clerkState = vi.hoisted(() => ({ userId: null as string | null, protectCalls: 0 }));
const modeState = vi.hoisted(() => ({ authMode: "clerk" as "clerk" | "builtin" | "none" }));

vi.mock("next/server", () => {
  class MockNextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(data), { ...init, headers });
    }
    static next() {
      return new Response(null, { status: 200, headers: { "x-middleware-next": "1" } });
    }
    static redirect(url: URL | string) {
      return new Response(null, { status: 307, headers: { location: String(url) } });
    }
  }
  return { NextResponse: MockNextResponse };
});

vi.mock("@clerk/nextjs/server", () => ({
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) =>
    patterns.some((pattern) => {
      const expression = pattern.replace(/\(\.\*\)/g, ".*");
      return new RegExp(`^${expression}$`).test(req.nextUrl.pathname);
    }),
  clerkMiddleware: (handler: (auth: unknown, request: NextRequest, event: unknown) => unknown) =>
    async (req: NextRequest, event: unknown) => {
      const auth = Object.assign(async () => ({ userId: clerkState.userId }), {
        protect: async () => {
          clerkState.protectCalls++;
          throw Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT" });
        },
      });
      const out = await handler(auth, req, event);
      return out === undefined
        ? new Response(null, { status: 200, headers: { "x-mw": "next" } })
        : (out as Response);
    },
}));

vi.mock("@/lib/mode", () => ({ effectiveAuth: () => modeState.authMode }));
vi.mock("@/lib/landing", () => ({ LOCAL_CHOICE_COOKIE: "tallyhand_local" }));

function fakeReq(path: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const url = new URL(`https://app.example${path}`);
  const cookieMap = new Map(Object.entries(cookies));
  return {
    nextUrl: Object.assign(url, {
      clone: () => new URL(url.toString()),
    }),
    headers: new Headers(headers),
    cookies: { get: (name: string) => {
      const value = cookieMap.get(name);
      return value === undefined ? undefined : { name, value };
    } },
  } as unknown as NextRequest;
}

const invoke = async (req: NextRequest): Promise<Response> =>
  (await middleware(req, {} as unknown as NextFetchEvent)) as Response;

beforeEach(() => {
  clerkState.userId = null;
  clerkState.protectCalls = 0;
  modeState.authMode = "clerk";
});

describe("middleware", () => {
  it.each(["/projects", "/timesheet", "/analytics", "/tax"])("requires a session or explicit local choice for %s", async (path) => {
    await expect(invoke(fakeReq(path))).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
    expect(clerkState.protectCalls).toBe(1);
    expect((await invoke(fakeReq(path, {}, { tallyhand_local: "1" }))).status).toBe(200);
    expect(clerkState.protectCalls).toBe(1);
  });
  it("returns the JSON 401 envelope for unauthenticated v1 API requests", async () => {
    const response = await invoke(fakeReq("/api/v1/clients"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Not signed in" } });
  });

  it("leaves the OpenAPI spec public", async () => {
    const response = await invoke(fakeReq("/api/v1/openapi.json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(clerkState.protectCalls).toBe(0);
  });

  it("leaves the health endpoint public", async () => {
    expect((await invoke(fakeReq("/api/health"))).status).toBe(200);
  });

  it("passes through public pages and endpoints", async () => {
    for (const path of ["/", "/login", "/login?next=/dashboard", "/share/abc123", "/invoice/public/xyz", "/api/share/resolve", "/api/auth/callback"]) {
      const response = await invoke(fakeReq(path));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("lets bearer API requests through to route-level token validation", async () => {
    const response = await invoke(fakeReq("/api/v1/clients", { Authorization: "Bearer bogus" }));
    expect(response.status).toBe(200);
    expect(clerkState.protectCalls).toBe(0);
  });

  it("passes through signed-in users", async () => {
    clerkState.userId = "user_123";
    const response = await invoke(fakeReq("/dashboard"));
    expect(response.status).toBe(200);
    expect(clerkState.protectCalls).toBe(0);
  });

  it("does not apply the local choice cookie to API routes", async () => {
    const response = await invoke(fakeReq("/api/v1/clients", {}, { tallyhand_local: "1" }));
    expect(response.status).toBe(401);
  });

  it("passes through app routes with the local choice cookie", async () => {
    const response = await invoke(fakeReq("/dashboard", {}, { tallyhand_local: "1" }));
    expect(response.status).toBe(200);
    expect(clerkState.protectCalls).toBe(0);
  });

  it("preserves Clerk page redirect behavior for unauthenticated app routes", async () => {
    await expect(invoke(fakeReq("/dashboard"))).rejects.toThrow("redirect");
    expect(clerkState.protectCalls).toBe(1);
  });

  it("returns the JSON 401 envelope for unauthenticated admin API requests", async () => {
    const response = await invoke(fakeReq("/api/admin/users"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Not signed in" } });
  });

  it("keeps builtin API auth behavior", async () => {
    modeState.authMode = "builtin";
    const response = await invoke(fakeReq("/api/v1/clients"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("passes through in none mode", async () => {
    modeState.authMode = "none";
    const response = await invoke(fakeReq("/api/v1/clients"));
    expect(response.status).toBe(200);
  });
});
