/**
 * Session/token auth gate for the entity CRUD routes (`requireApiOrSession`).
 *
 * Semantics under test:
 * - No session: falls through to the bearer <redacted> unchanged (401 when
 *   TALLYHAND_API_TOKEN is set and no/wrong token, no CSRF header needed).
 * - Session (simulated by mocking `tryResolveSessionUserId` — a real Clerk /
 *   builtin session cookie cannot be minted in the node test env): GET/HEAD
 *   pass with no header; non-GET writes are rejected 400 without the
 *   `x-tallyhand-sync: 1` header and pass with it.
 * - Token-resolved callers do not require the custom header for writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataOf,
  jsonBody,
  makeRequest,
  readJson,
  setupApiEnv,
  teardownApiEnv,
} from "./helpers";

import { requireApiOrSession } from "../_lib/sync-auth";
import { POST as clientsPost } from "../clients/route";

const mockSessionUser = vi.hoisted(() => ({ userId: null as string | null }));
const mockTokenResolvedUser = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...orig,
    tryResolveSessionUserId: async () => mockSessionUser.userId,
    tryResolveSyncUserId: async () => mockTokenResolvedUser.userId,
  };
});

describe("requireApiOrSession", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = setupApiEnv();
    mockSessionUser.userId = null;
    mockTokenResolvedUser.userId = null;
  });

  afterEach(() => {
    teardownApiEnv(dbPath);
    mockSessionUser.userId = null;
    mockTokenResolvedUser.userId = null;
  });

  it("session-less, token-less GET is 401 (not 503) when the API token is set", async () => {
    const err = await requireApiOrSession(makeRequest("/api/v1/clients", {}, false));
    expect(err).not.toBeNull();
    const { status, body } = await readJson(err as Response);
    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("session-less token GET passes without the CSRF header (token path unchanged)", async () => {
    const err = await requireApiOrSession(makeRequest("/api/v1/clients"));
    expect(err).toBeNull();
  });

  it("session GET passes without the CSRF header", async () => {
    mockSessionUser.userId = "user-1";
    const err = await requireApiOrSession(makeRequest("/api/v1/clients", {}, false));
    expect(err).toBeNull();
  });

  it("session POST without the CSRF header is rejected with 400", async () => {
    mockSessionUser.userId = "user-1";
    const err = await requireApiOrSession(
      makeRequest("/api/v1/clients", { method: "POST" }, false),
    );
    expect(err).not.toBeNull();
    const { status, body } = await readJson(err as Response);
    expect(status).toBe(400);
    expect((body as { error: { message: string } }).error.message).toContain(
      "x-tallyhand-sync",
    );
  });

  it("session POST with the CSRF header passes", async () => {
    mockSessionUser.userId = "user-1";
    const err = await requireApiOrSession(
      makeRequest(
        "/api/v1/clients",
        { method: "POST", headers: { "x-tallyhand-sync": "1" } },
        false,
      ),
    );
    expect(err).toBeNull();
  });

  it.each(["POST", "PATCH", "DELETE"] as const)(
    "token-resolved %s passes without the CSRF header",
    async (method) => {
      mockTokenResolvedUser.userId = "user-token";
      const err = await requireApiOrSession(
        makeRequest("/api/v1/clients", { method }),
      );
      expect(err).toBeNull();
    },
  );

  it.each(["POST", "PATCH", "DELETE"] as const)(
    "session %s without the CSRF header is rejected",
    async (method) => {
      mockSessionUser.userId = "user-1";
      const err = await requireApiOrSession(
        makeRequest("/api/v1/clients", { method }, false),
      );
      expect(err).not.toBeNull();
      const { status, body } = await readJson(err as Response);
      expect(status).toBe(400);
      expect((body as { error: { message: string } }).error.message).toContain(
        "x-tallyhand-sync",
      );
    },
  );

  it("bearer-token POST without the custom header still 201s (CLI unchanged)", async () => {
    const res = await clientsPost(
      makeRequest("/api/v1/clients", {
        method: "POST",
        headers: { authorization: "Bearer test-api-token" },
        body: jsonBody({ name: "Acme", defaultRate: 150 }),
      }),
    );
    const { status, body } = await readJson(res);
    expect(status).toBe(201);
    expect(dataOf<{ name: string }>(body).name).toBe("Acme");
  });
});
