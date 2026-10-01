/**
 * SERVER ONLY — shared auth for the encrypted-sync REST routes
 * (`/api/v1/sync/*`).
 *
 * Sync must work from two very different clients:
 * 1. The browser PWA — signed in via cookie (Clerk session or the builtin
 *    `tally_session` cookie). No API token is available client-side.
 * 2. Machines/CLI — the v1 Bearer <redacted> convention (TALLYHAND_API_TOKEN),
 *    mapped to a user id by the auth layer exactly like every other v1
 *    route (see `src/lib/auth/session.ts`).
 *
 * Returns `{ userId }` (whatever user id the auth layer resolved — the
 * task contract says to accept it) or an error Response. POST routes must
 * additionally require the `x-tallyhand-sync: 1` header: it makes the
 * endpoint unreachable from a bare cross-site <form> POST, which is the
 * cheap CSRF mitigation for cookie-authenticated JSON APIs on same-origin
 * apps like this one.
 */
import { requireApiToken } from "@/server/auth";
import { json } from "@/server/http";
import {
  tryResolveSessionUserId,
  tryResolveSyncUserId,
  resolveUserId,
} from "@/lib/auth/session";

export interface SyncAuth {
  userId: string;
  /** "session" (browser cookie) or "token" (machine API token). */
  via: "session" | "token";
}

export async function requireSyncAuth(
  req: Request,
): Promise<SyncAuth | Response> {
  // tryResolveSyncUserId (not tryResolveUserId): sync needs real auth —
  // the "local" pseudo-user of TALLY_AUTH=none must not open the vault.
  const sessionUser = await tryResolveSyncUserId();
  if (sessionUser) return { userId: sessionUser, via: "session" };

  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  try {
    const userId = await resolveUserId();
    return { userId, via: "token" };
  } catch {
    return json(
      { error: { code: "unauthorized", message: "Not signed in" } },
      401,
    );
  }
}

/**
 * Entity-CRUD gate (session-first, token fallback — same shape as the sync
 * routes in requireSyncAuth, but returning the gate's error-Response-or-null
 * convention so existing route handlers slot it in).
 *
 * - Session (browser cookie): sync-vault parity — the vault already serves
 *   this data to sessions, so the plaintext REST tables may too.
 * - Writes under a cookie session additionally require the
 *   `x-tallyhand-sync: 1` header (cheap CSRF mitigation; see
 *   requireSyncHeader). Bearer <redacted> are not cookies, so token callers
 *   (the CLI) never need the header.
 * - No session and no token: falls through to requireApiToken, whose
 *   503 `api_disabled` / 401 `unauthorized` behavior is unchanged.
 */
export async function requireApiOrSession(
  req: Request,
): Promise<Response | null> {
  // Explicit machine credentials must not inherit a cookie's broader access.
  if (/^Bearer\s/i.test(req.headers.get("authorization") ?? "")) return requireApiToken(req);
  const sessionUser = await tryResolveSessionUserId();
  if (sessionUser) {
    if (req.method !== "GET" && req.method !== "HEAD") return requireSyncHeader(req);
    return null;
  }
  return requireApiToken(req);
}

/**
 * CSRF guard for cookie-authenticated JSON POSTs: a cross-site form cannot
 * set a custom header, while our own client and machine clients can.
 * Bearer-token callers are not cookie sessions and never need this header.
 */
export function requireSyncHeader(req: Request): Response | null {
  if (req.headers.get("x-tallyhand-sync") !== "1") {
    return json(
      {
        error: {
          code: "bad_request",
          message: "Missing required header: x-tallyhand-sync: 1",
        },
      },
      400,
    );
  }
  return null;
}
