/**
 * SERVER ONLY. Threat model: OAuth tokens are high-value bearer credentials,
 * so at-rest database disclosure must not reveal them. AES-GCM authenticates
 * ciphertext and HKDF prevents reuse of one derived key for encryption and
 * OAuth state signing. The master key exists only in process memory and is
 * read lazily from TALLY_ENCRYPTION_KEY; callers must protect the runtime
 * environment and backups. State is short-lived and bound to a user, but is
 * not a substitute for TLS or session security. Never log plaintext, keys,
 * envelopes, OAuth codes, or raw crypto errors.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export class CryptoConfigError extends Error { constructor(message = "TALLY_ENCRYPTION_KEY is missing or invalid") { super(message); this.name = "CryptoConfigError"; } }
export class DecryptionError extends Error { constructor() { super("Unable to decrypt Stripe Connect secret"); this.name = "DecryptionError"; } }
const encInfo = Buffer.from("tallyhand/stripe-connect/encryption/v1");
const stateInfo = Buffer.from("tallyhand/stripe-connect/oauth-state-hmac/v1");
function masterKey(): Buffer {
  const raw = process.env.TALLY_ENCRYPTION_KEY;
  if (!raw) throw new CryptoConfigError();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded;
  }
  throw new CryptoConfigError();
}
function derive(info: Buffer): Buffer { return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), info, 32)); }
export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(encInfo), nonce);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return JSON.stringify({ v: 1, alg: "aes-256-gcm", iv: nonce.toString("base64url"), ct: ct.toString("base64url"), tag: c.getAuthTag().toString("base64url") });
}
export function decryptSecret(envelopeJson: string): string {
  try {
    const e = JSON.parse(envelopeJson) as Record<string, unknown>;
    if (e.v !== 1 || e.alg !== "aes-256-gcm" || typeof e.iv !== "string" || typeof e.ct !== "string" || typeof e.tag !== "string") throw new Error();
    const iv = Buffer.from(e.iv, "base64url"), ct = Buffer.from(e.ct, "base64url"), tag = Buffer.from(e.tag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const d = createDecipheriv("aes-256-gcm", derive(encInfo), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (err) { if (err instanceof CryptoConfigError) throw err; throw new DecryptionError(); }
}
const STATE_TTL = 10 * 60 * 1000;
export function signState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + STATE_TTL })).toString("base64url");
  const sig = createHmac("sha256", derive(stateInfo)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function verifyState(state: string, expectedUserId?: string): string {
  try {
    const [payload, sig, extra] = state.split("."); if (!payload || !sig || extra) throw new Error();
    const expected = createHmac("sha256", derive(stateInfo)).update(payload).digest();
    const got = Buffer.from(sig, "base64url"); if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error();
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: unknown; exp?: unknown };
    if (typeof p.userId !== "string" || typeof p.exp !== "number" || p.exp <= Date.now() || (expectedUserId !== undefined && p.userId !== expectedUserId)) throw new Error();
    return p.userId;
  } catch (err) { if (err instanceof CryptoConfigError) throw err; throw new Error("Invalid or expired OAuth state"); }
}
