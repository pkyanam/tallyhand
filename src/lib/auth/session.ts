/**
 * Resolve the current user id for data access (server-side).
 *
 * Contract (effective `TALLY_AUTH`, see `effectiveAuth()` in `@/lib/mode` —
 * explicit TALLY_AUTH wins, otherwise Clerk keys auto-detect `clerk`):
 * - `none`    → single-user local mode; every call resolves to `"local"`.
 * - `clerk`   → Clerk session via @clerk/nextjs (`auth()`); a personal API
 *   token (`thp_…`, Settings → Connect) in the Authorization header
 *   resolves to its owner's user id without a session; throws 401 when
 *   neither is present. Dynamic import keeps the package out of the static
 *   graph.
 * - `builtin` → HMAC-signed `tally_session` cookie (see `builtin.ts`);
 *   falls back to API-token machine access: personal `thp_…` tokens map to
 *   their owner, the shared TALLYHAND_API_TOKEN maps through
 *   `TALLYHAND_HOSTED_CLI_USER_ID` (v1 routes verify the token first).
 *
 * There is intentionally no unauthenticated fallback when auth != none:
 * every hosted query is scoped by the resolved userId (see the
 * PostgresStorageProvider isolation tests).
 *
 * SERVER ONLY — uses next/headers.
 */
import { cookies, headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { effectiveAuth } from "@/lib/mode";
import { verifyBuiltinSession, getBuiltinUserById } from "./builtin";

/** Single-user id used when TALLY_AUTH=none. */
export const LOCAL_USER_ID = "local";

function bearerTokenFromHeaders(header: string | null): string {
  const match = /^Bearer (.+)$/.exec((header ?? "").trim());
  return match ? match[1] : "";
}

function bearerMatches(header: string, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match || !token) return false;
  const a = Buffer.from(match[1], "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function unauthorized(message = "Not signed in"): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  err.status = 401;
  return err;
}

/**
 * Resolve a personal API token (`thp_…`) from the Authorization header to
 * its owner's user id. Returns null when no (valid) personal token is
 * presented. Lazy import keeps the token store out of the module graph.
 */
async function personalTokenUserId(): Promise<string | null> {
  const headerList = await headers();
  const presented = bearerTokenFromHeaders(headerList.get("authorization"));
  if (!presented) return null;
  const { isOAuthToken, verifyTallyOAuth } = await import("./oauth");
  if (isOAuthToken(presented)) return (await verifyTallyOAuth(presented))?.userId ?? null;
  const { findApiToken } = await import("./api-tokens");
  const verified = await findApiToken(presented);
  return verified ? verified.userId : null;
}

type ClerkAuthFn = () => { userId?: string | null } | Promise<{ userId?: string | null }>;

async function clerkAuthFn(): Promise<ClerkAuthFn> {
  // Dynamic import (not require): matches the middleware pattern and keeps
  // @clerk/nextjs out of the static module graph for non-Clerk deployments.
  // In the bundled route this resolves to the same server `auth()` the
  // middleware uses via `await import("@clerk/nextjs/server")`.
  const mod = (await import("@clerk/nextjs/server")) as typeof import(
    "@clerk/nextjs/server"
  );
  const authFn = (mod as { auth: unknown }).auth as ClerkAuthFn | undefined;
  if (!authFn) throw new Error("Clerk auth() not available");
  return authFn;
}

async function clerkUserId(): Promise<string> {
  // Personal API token first: machine clients have no Clerk session cookie.
  const tokenUserId = await personalTokenUserId();
  if (tokenUserId) return tokenUserId;

  const auth = await clerkAuthFn();
  const session = await auth();
  if (!session?.userId) throw unauthorized();
  return session.userId;
}

/** Clerk session only — personal bearer tokens are NOT accepted here. */
async function clerkSessionUserId(): Promise<string> {
  const auth = await clerkAuthFn();
  const session = await auth();
  if (!session?.userId) throw unauthorized();
  return session.userId;
}

async function builtinUserId(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get("tally_session")?.value;
  const secret = process.env.BUILTIN_AUTH_SECRET ?? "";
  const userId = raw ? verifyBuiltinSession(raw, secret) : null;
  if (userId) {
    // Re-check the user row on every resolution: a disabled (or deleted)
    // user must lose access immediately, even with a valid cookie.
    const user = await getBuiltinUserById(userId);
    if (user && !user.disabled) return userId;
  }

  // Machine/CLI access: personal tokens map to their owner…
  const tokenUserId = await personalTokenUserId();
  if (tokenUserId) return tokenUserId;

  // …and the shared env token maps through TALLYHAND_HOSTED_CLI_USER_ID
  // (v1 routes already verified the Bearer <redacted>
  const headerList = await headers();
  const token = process.env.TALLYHAND_API_TOKEN ?? "";
  const cliUserId = process.env.TALLYHAND_HOSTED_CLI_USER_ID;
  if (
    cliUserId &&
    bearerMatches(headerList.get("authorization") ?? "", token)
  ) {
    return cliUserId;
  }
  throw unauthorized();
}

/** Builtin session cookie only — bearer tokens are NOT accepted here. */
async function builtinSessionUserId(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get("tally_session")?.value;
  const secret = process.env.BUILTIN_AUTH_SECRET ?? "";
  const userId = raw ? verifyBuiltinSession(raw, secret) : null;
  if (!userId) throw unauthorized();
  const user = await getBuiltinUserById(userId);
  if (!user || user.disabled) throw unauthorized();
  return userId;
}

/** Resolve the owner id every hosted query is scoped by. */
export async function resolveUserId(): Promise<string> {
  const auth = effectiveAuth();
  if (auth === "none") return LOCAL_USER_ID;
  if (auth === "clerk") return clerkUserId();
  return builtinUserId();
}

/** Like resolveUserId() but returns null instead of throwing. */
export async function tryResolveUserId(): Promise<string | null> {
  try {
    return await resolveUserId();
  } catch {
    return null;
  }
}

/**
 * Resolve the user id from an interactive session ONLY (Clerk session or
 * builtin session cookie). Bearer tokens — shared or personal — are NOT
 * accepted: this guards self-service account operations (e.g. API-token
 * management in Settings → Connect) so a leaked token can't mint fresh
 * tokens. Throws 401 when there is no session.
 */
export async function requireSessionUserId(): Promise<string> {
  const auth = effectiveAuth();
  if (auth === "clerk") return clerkSessionUserId();
  if (auth === "builtin") return builtinSessionUserId();
  throw unauthorized("No signed-in user in single-user local mode");
}

/** Like requireSessionUserId() but returns null when there is no session. */
export async function tryResolveSessionUserId(): Promise<string | null> {
  try {
    return await requireSessionUserId();
  } catch {
    return null;
  }
}

/**
 * Sync-scoped variant: only REAL auth counts. In local mode
 * (`TALLY_AUTH=none`) `resolveUserId()` falls back to the `"local"`
 * pseudo-user, but there is no account to scope a cloud vault to — sync
 * must be unavailable there, so the local fallback is excluded here.
 */
export async function tryResolveSyncUserId(): Promise<string | null> {
  // Use the same effective mode as resolveUserId()/middleware. Production
  // deployments commonly omit TALLY_AUTH and let the presence of Clerk keys
  // select Clerk automatically; parseAuth() alone reports "none" there and
  // used to make /api/v1/sync/status claim the signed-in user was signed out.
  if (effectiveAuth() === "none") return null;
  return tryResolveUserId();
}
