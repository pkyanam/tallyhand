/**
 * Builtin auth for self-hosters (`TALLY_AUTH=builtin`): email magic links.
 *
 * Flow:
 * 1. `POST /api/auth/builtin/request` { email } → look up the user
 *    (first-ever user bootstraps as admin; everyone else must have been
 *    invited by an admin), store a single-use hashed token (15 min expiry),
 *    link via SMTP or — when no SMTP is configured — print it to the server
 *    logs (the standard self-host fallback; the operator forwards it).
 * 2. `GET /api/auth/builtin/verify?token=…` → validates, marks used,
 *    sets the `tally_session` cookie: `base64url({uid,exp}).base64url(sig)`,
 *    HMAC-SHA256 over `BUILTIN_AUTH_SECRET`, 30-day expiry.
 * 3. `resolveUserId()` verifies that cookie on every request.
 *
 * User/token rows live in Postgres (`builtin_users`, `builtin_login_tokens`;
 * see drizzle/0001_init.sql), accessed with raw `pg` SQL — no ORM needed.
 * The first user ever created is automatically `admin` (bootstrap); the
 * admin UI manages the rest.
 *
 * SERVER ONLY — dynamic requires keep pg/nodemailer out of the static
 * import graph.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { newId } from "@/core/id";
import type { DbRow } from "@/lib/db/hosted-types";
import { dbStr } from "@/lib/db/hosted-types";

export const BUILTIN_SESSION_COOKIE = "tally_session";
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface BuiltinUserRow {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member" | "viewer";
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// -- signed session cookies ------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signBuiltinSession(userId: string, secret: string): string {
  if (!secret) throw new Error("BUILTIN_AUTH_SECRET is required");
  const body = b64url(
    Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }), "utf8"),
  );
  const sig = b64url(createHmac("sha256", secret).update(body, "utf8").digest());
  return `${body}.${sig}`;
}

/** Returns the user id, or null when the cookie is invalid/expired. */
export function verifyBuiltinSession(cookieValue: string, secret: string): string | null {
  try {
    if (!cookieValue || !secret) return null;
    const [body, sig] = cookieValue.split(".");
    if (!body || !sig) return null;
    const expected = b64url(createHmac("sha256", secret).update(body, "utf8").digest());
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(unb64url(body).toString("utf8")) as {
      uid?: string;
      exp?: number;
    };
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

// -- postgres access (raw pg, dynamic) -------------------------------------

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: DbRow[]; rowCount: number }>;
};

let pool: PgPool | null = null;

function getPool(): PgPool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("TALLY_AUTH=builtin requires DATABASE_URL");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  pool = new Pool({ connectionString: url }) as unknown as PgPool;
  return pool;
}

function toUser(row: DbRow): BuiltinUserRow {
  return {
    id: row.id as string,
    email: row.email as string,
    name: typeof row.name === "string" ? row.name : null,
    role: row.role === "admin" || row.role === "viewer" ? row.role : "member",
    disabled: Boolean(row.disabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getBuiltinUserById(id: string): Promise<BuiltinUserRow | null> {
  const { rows } = await getPool().query(`SELECT * FROM builtin_users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function getBuiltinUserByEmail(email: string): Promise<BuiltinUserRow | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM builtin_users WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function listBuiltinUsers(): Promise<BuiltinUserRow[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM builtin_users ORDER BY created_at ASC`,
  );
  return rows.map(toUser);
}

async function createBuiltinUser(
  email: string,
  role: "admin" | "member" | "viewer",
): Promise<BuiltinUserRow> {
  const now = Date.now();
  const id = newId("usr");
  const { rows } = await getPool().query(
    `INSERT INTO builtin_users (id, email, name, role, disabled, created_at, updated_at)
     VALUES ($1, $2, NULL, $3, FALSE, $4, $4) RETURNING *`,
    [id, email, role, now],
  );
  return toUser(rows[0]);
}

export async function updateBuiltinUser(
  id: string,
  patch: { role?: "admin" | "member" | "viewer"; disabled?: boolean; name?: string | null },
): Promise<void> {
  const sets: string[] = ["updated_at = $1"];
  const params: unknown[] = [Date.now()];
  let i = 2;
  if (patch.role !== undefined) {
    sets.push(`role = $${i++}`);
    params.push(patch.role);
  }
  if (patch.disabled !== undefined) {
    sets.push(`disabled = $${i++}`);
    params.push(patch.disabled);
  }
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(patch.name);
  }
  params.push(id);
  await getPool().query(
    `UPDATE builtin_users SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
}

export async function deleteBuiltinUser(id: string): Promise<void> {
  await getPool().query(`DELETE FROM builtin_users WHERE id = $1`, [id]);
}

// -- magic links ------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface MagicLinkResult {
  user: BuiltinUserRow;
  /** The one-time URL. Emailed when SMTP is configured, otherwise logged. */
  url: string;
  /** True when the link was emailed; false when it was printed to logs. */
  emailed: boolean;
}

/**
 * Request a login link for `email`. Creates the user on first sight (the
 * very first user becomes admin). Returns the link; the caller decides
 * delivery. Throws on invalid email.
 */
export async function requestMagicLink(email: string): Promise<MagicLinkResult> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email address");
  }
  let user = await getBuiltinUserByEmail(normalized);
  if (!user) {
    const existing = await listBuiltinUsers();
    if (existing.length === 0) {
      // Bootstrap: the very first user becomes admin.
      user = await createBuiltinUser(normalized, "admin");
    } else {
      // Everyone else must be invited by an admin first (the admin UI
      // creates the user row with the intended role).
      throw new Error("No account for this email — ask an admin to invite you");
    }
  }
  if (user.disabled) throw new Error("This account is disabled");

  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await getPool().query(
    `INSERT INTO builtin_login_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [newId("mlt"), user.id, hashToken(token), now + MAGIC_LINK_TTL_MS, now],
  );

  const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("TALLY_AUTH=builtin requires APP_BASE_URL");
  const url = `${base}/api/auth/builtin/verify?token=${token}`;

  const emailed = await sendMagicLinkEmail(normalized, url);
  if (!emailed) {
    // Standard self-host fallback: no SMTP configured → print to server logs.
    console.log(`[tallyhand] Login link for ${normalized}: ${url}`);
  }
  return { user, url, emailed };
}

/** Validate a magic token (single-use, 15 min). Returns the user or null. */
export async function consumeMagicToken(token: string): Promise<BuiltinUserRow | null> {
  if (!token) return null;
  const now = Date.now();
  const { rows } = await getPool().query(
    `SELECT t.*, u.disabled AS user_disabled FROM builtin_login_tokens t
     JOIN builtin_users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.used_at != null || Number(row.expires_at) <= now || row.user_disabled) {
    return null;
  }
  await getPool().query(`UPDATE builtin_login_tokens SET used_at = $1 WHERE id = $2`, [
    now,
    row.id,
  ]);
  return getBuiltinUserById(dbStr(row, "user_id"));
}

async function sendMagicLinkEmail(to: string, url: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as typeof import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "1",
      auth:
        process.env.SMTP_USER != null
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
          : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? "tallyhand@localhost",
      to,
      subject: "Your Tallyhand login link",
      text: `Sign in to Tallyhand with this one-time link (expires in 15 minutes):\n\n${url}\n`,
    });
    return true;
  } catch (err) {
    console.error("[tallyhand] SMTP send failed, falling back to log:", err);
    return false;
  }
}

/** Test helper: drop the cached pg pool. */
export function resetBuiltinPoolForTests(): void {
  pool = null;
}
