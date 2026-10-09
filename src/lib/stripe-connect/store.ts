/** SERVER ONLY — stores encrypted Stripe Connect OAuth credentials. */
import { DatabaseSync } from "node:sqlite";
import { createConvexRequestClient } from "@/lib/db/convex-client";
import { parseStorage } from "@/lib/mode";
import { resolveDbPath } from "@/server/sqlite-provider";
import { decryptSecret } from "@/lib/crypto/connect-crypto";

export interface StripeConnectionInput { accountId: string; livemode: boolean; chargesEnabled: boolean | null; payoutsEnabled: boolean | null; secretEnvelope: string }
export interface StripeConnectionMeta { userId: string; accountId: string; livemode: boolean; chargesEnabled: boolean | null; payoutsEnabled: boolean | null; createdAt: number; updatedAt: number }
function cloud() { return createConvexRequestClient(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? ""); }
type Row = Record<string, unknown>;
const SCHEMA = `CREATE TABLE IF NOT EXISTS stripe_connections (user_id TEXT PRIMARY KEY, stripe_account_id TEXT NOT NULL, livemode INTEGER NOT NULL, charges_enabled INTEGER, payouts_enabled INTEGER, secret_envelope TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS stripe_connections_account_idx ON stripe_connections (stripe_account_id);`;
type PgPool = { query: (q: string, p?: unknown[]) => Promise<{ rows: Row[]; rowCount: number }> };
let pool: PgPool | null = null, ensured = false;
async function pg(): Promise<PgPool> { if (pool) return pool; const url = process.env.DATABASE_URL; if (!url) throw new Error("TALLY_STORAGE=postgres requires DATABASE_URL"); const { Pool } = await import("pg"); pool = new Pool({ connectionString: url }) as unknown as PgPool; return pool; }
async function ensurePg() { if (!ensured) { await (await pg()).query(SCHEMA); ensured = true; } }
function backend() { const s = parseStorage(); if (s === "convex") return "convex"; return s === "postgres" || s === "neon" ? "pg" : "sqlite"; }
function sqlite<T>(fn: (db: DatabaseSync) => T): T { const db = new DatabaseSync(resolveDbPath()); try { db.exec(SCHEMA); return fn(db); } finally { db.close(); } }
function meta(r: Row): StripeConnectionMeta { return { userId: String(r.user_id), accountId: String(r.stripe_account_id), livemode: Boolean(r.livemode), chargesEnabled: r.charges_enabled == null ? null : Boolean(r.charges_enabled), payoutsEnabled: r.payouts_enabled == null ? null : Boolean(r.payouts_enabled), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }; }
export async function saveStripeConnection(userId: string, v: StripeConnectionInput): Promise<StripeConnectionMeta> { if (backend() === "convex") return await cloud().mutation("stripeConnections:save", { userId, ...v }) as StripeConnectionMeta; const now = Date.now(); if (backend() === "pg") { await ensurePg(); const { rows } = await (await pg()).query(`INSERT INTO stripe_connections (user_id,stripe_account_id,livemode,charges_enabled,payouts_enabled,secret_envelope,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(user_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id,livemode=EXCLUDED.livemode,charges_enabled=EXCLUDED.charges_enabled,payouts_enabled=EXCLUDED.payouts_enabled,secret_envelope=EXCLUDED.secret_envelope,updated_at=EXCLUDED.updated_at RETURNING *`, [userId,v.accountId,+v.livemode,v.chargesEnabled == null ? null : +v.chargesEnabled,v.payoutsEnabled == null ? null : +v.payoutsEnabled,v.secretEnvelope,now]); return meta(rows[0]); } return sqlite(db => { db.prepare(`INSERT INTO stripe_connections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stripe_account_id=excluded.stripe_account_id,livemode=excluded.livemode,charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,secret_envelope=excluded.secret_envelope,updated_at=excluded.updated_at`).run(userId,v.accountId,+v.livemode,v.chargesEnabled == null ? null : +v.chargesEnabled,v.payoutsEnabled == null ? null : +v.payoutsEnabled,v.secretEnvelope,now,now); return meta(db.prepare("SELECT * FROM stripe_connections WHERE user_id=?").get(userId) as Row); }); }
export async function getStripeConnectionMeta(userId: string): Promise<StripeConnectionMeta | null> { if (backend() === "convex") return await cloud().query("stripeConnections:metadata", { userId }) as StripeConnectionMeta | null; let r: Row | undefined; if (backend() === "pg") { await ensurePg(); r = (await (await pg()).query("SELECT user_id,stripe_account_id,livemode,charges_enabled,payouts_enabled,created_at,updated_at FROM stripe_connections WHERE user_id=$1",[userId])).rows[0]; } else r = sqlite(db => db.prepare("SELECT user_id,stripe_account_id,livemode,charges_enabled,payouts_enabled,created_at,updated_at FROM stripe_connections WHERE user_id=?").get(userId) as Row | undefined); return r ? meta(r) : null; }
export async function getStripeConnectionSecret(userId: string, binding?: { accountId: string; livemode: boolean }): Promise<string | null> {
  const m = binding ?? await getStripeConnectionMeta(userId);
  if (!m) return null;
  if (backend() === "convex") {
    const envelope = await cloud().query("stripeConnections:credential", { userId, accountId: m.accountId, livemode: m.livemode });
    return envelope ? decryptSecret(String(envelope)) : null;
  }
  let r: Row | undefined;
  if (backend() === "pg") { await ensurePg(); r = (await (await pg()).query("SELECT secret_envelope FROM stripe_connections WHERE user_id=$1 AND stripe_account_id=$2 AND livemode=$3", [userId,m.accountId,+m.livemode])).rows[0]; }
  else r = sqlite(db => db.prepare("SELECT secret_envelope FROM stripe_connections WHERE user_id=? AND stripe_account_id=? AND livemode=?").get(userId,m.accountId,+m.livemode) as Row | undefined);
  return r ? decryptSecret(String(r.secret_envelope)) : null;
}
/** Mode is mandatory for routing; legacy calls fail closed. */
export async function findUserIdByStripeAccount(accountId: string, livemode?: boolean): Promise<string | null> {
  if (typeof livemode !== "boolean") return null;
  if (backend() === "convex") return await cloud().query("stripeConnections:ownerForAccount", { accountId, livemode }) as string | null;
  let rows: Row[];
  if (backend() === "pg") { await ensurePg(); rows = (await (await pg()).query("SELECT user_id FROM stripe_connections WHERE stripe_account_id=$1 AND livemode=$2 LIMIT 2", [accountId,+livemode])).rows; }
  else rows = sqlite(db => db.prepare("SELECT user_id FROM stripe_connections WHERE stripe_account_id=? AND livemode=? LIMIT 2").all(accountId,+livemode) as Row[]);
  return rows.length === 1 ? String(rows[0].user_id) : null;
}
export async function deleteStripeConnection(userId: string): Promise<void> { if (backend() === "convex") { await cloud().mutation("stripeConnections:remove", { userId }); return; } if (backend() === "pg") { await ensurePg(); await (await pg()).query("DELETE FROM stripe_connections WHERE user_id=$1",[userId]); } else sqlite(db => { db.prepare("DELETE FROM stripe_connections WHERE user_id=?").run(userId); }); }
export function __resetStripeConnectionCaches() { const old=pool; pool=null; ensured=false; void (old as unknown as {end?:()=>Promise<void>} | null)?.end?.(); }
