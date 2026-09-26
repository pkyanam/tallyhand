/**
 * Resolve the current user id for data access (server-side).
 *
 * Contract (`TALLY_AUTH`):
 * - `none`    → single-user local mode; every call resolves to `"local"`.
 * - `clerk`   → Clerk session via @clerk/nextjs (`auth()`); throws 401 when
 *   signed out. Dynamic import keeps the package out of the static graph.
 * - `builtin` → HMAC-signed `tally_session` cookie (see `builtin.ts`);
 *   falls back to API-token machine access mapped through
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
import { parseAuth } from "@/lib/mode";
import { verifyBuiltinSession, getBuiltinUserById } from "./builtin";

/** Single-user id used when TALLY_AUTH=none. */
export const LOCAL_USER_ID = "local";

function bearerMatches(header: string, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match || !token) return false;
  const a = Buffer.from(match[1], "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function clerkUserId(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@clerk/nextjs/server") as typeof import("@clerk/nextjs/server");
  const authFn = (mod as { auth: unknown }).auth as
    | (() => { userId?: string | null } | Promise<{ userId?: string | null }>)
    | undefined;
  if (!authFn) throw new Error("Clerk auth() not available");
  const session = await authFn();
  if (!session?.userId) {
    const err = new Error("Not signed in") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
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

  // Machine/CLI access: v1 routes already verified the bearer token.
  const headerList = await headers();
  const token = process.env.TALLYHAND_API_TOKEN ?? "";
  const cliUserId = process.env.TALLYHAND_HOSTED_CLI_USER_ID;
  if (
    cliUserId &&
    bearerMatches(headerList.get("authorization") ?? "", token)
  ) {
    return cliUserId;
  }
  const err = new Error("Not signed in") as Error & { status?: number };
  err.status = 401;
  throw err;
}

/** Resolve the owner id every hosted query is scoped by. */
export async function resolveUserId(): Promise<string> {
  const auth = parseAuth();
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
