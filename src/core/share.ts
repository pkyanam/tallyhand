/**
 * Signed public share tokens (hosted mode).
 *
 * Design:
 * - A share link is a database row (`share_links`) carrying the owner
 *   `userId`, the link type, the target payload, an expiry timestamp, and a
 *   nullable `revokedAt` for per-link revocation.
 * - The public token is `th1.<base64url(payload)>.<base64url(sig)>` where
 *   `payload = { v: 1, lid, typ, exp }` and `sig = HMAC-SHA256(serverSecret,
 *   base64url(payload))`.
 * - Verification is stateless: parse, check the HMAC with a timing-safe
 *   compare, check `exp`. The route then loads the link row by `lid` to
 *   enforce revocation and resolve the owner for user-scoped data access.
 *   Possession of a valid token is the capability — no login required.
 *
 * Pure and dependency-free (node:crypto only) so the sign/verify logic is
 * trivially testable without a database.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { newId } from "./id";

export type ShareLinkType = "invoice" | "timesheet" | "estimate";

export interface ShareTokenPayload {
  /** Token format version. */
  v: 1;
  /** Share link row id (`shl_…`). */
  lid: string;
  /** What the link shares. */
  typ: ShareLinkType;
  /** Expiry as epoch milliseconds. */
  exp: number;
}

const TOKEN_PREFIX = "th1";

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

/** Create a new share-link row id. */
export function newShareLinkId(): string {
  return newId("shl");
}

export function signShareToken(
  payload: ShareTokenPayload,
  secret: string,
): string {
  if (!secret) throw new Error("signShareToken requires a server secret");
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = base64urlEncode(
    createHmac("sha256", secret).update(body, "utf8").digest(),
  );
  return `${TOKEN_PREFIX}.${body}.${sig}`;
}

export function verifyShareToken(
  token: string,
  secret: string,
): ShareTokenPayload | null {
  try {
    if (!token || !secret) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const [, body, sig] = parts;

    const expected = base64urlEncode(
      createHmac("sha256", secret).update(body, "utf8").digest(),
    );
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      base64urlDecode(body).toString("utf8"),
    ) as ShareTokenPayload;
    if (
      payload?.v !== 1 ||
      typeof payload.lid !== "string" ||
      !["invoice", "timesheet", "estimate"].includes(payload.typ) ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Build the public URL path for a signed token (host decides the origin). */
export function sharePathForToken(token: string): string {
  return `/share/${encodeURIComponent(token)}`;
}
