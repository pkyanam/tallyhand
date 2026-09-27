/**
 * Client-side cryptography for end-to-end encrypted sync.
 *
 * - One AES-GCM-256 data-encryption key (DEK) per user, generated on first
 *   sign-in, stored in IndexedDB, NEVER sent to the server.
 * - The server only ever sees `{ iv, ciphertext }` base64 blobs
 *   (see `src/lib/db/sync-store.ts`).
 *
 * WebCrypto only (no dependencies, no Node builtins): safe to import from
 * client components. Works in browsers and in Node 20+ (vitest), where
 * `globalThis.crypto.subtle` exists.
 */

const AES_ALG = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this environment");
  return c.subtle;
}

/** base64url (no padding) — safe to paste into a text field or URL. */
export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Generate a fresh per-user data key. */
export async function generateDataKey(): Promise<CryptoKey> {
  return subtle().generateKey(
    { name: AES_ALG, length: KEY_LENGTH },
    true, // extractable: the user must be able to export it for a 2nd device
    ["encrypt", "decrypt"],
  );
}

/** Export a data key as a portable base64url string (copy/paste for device 2). */
export async function exportDataKey(key: CryptoKey): Promise<string> {
  const jwk = await subtle().exportKey("jwk", key);
  if (jwk.kty !== "oct" || typeof jwk.k !== "string") {
    throw new Error("Unexpected key type — expected an AES JWK");
  }
  return jwk.k;
}

/**
 * Import a data key from its exported string. Throws on malformed input
 * (wrong length, not base64url, not a 256-bit key).
 */
export async function importDataKey(exported: string): Promise<CryptoKey> {
  const raw = exported.trim();
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(raw)) {
    throw new Error(
      "That doesn't look like a Tallyhand sync key (expected ~43 base64url characters).",
    );
  }
  const bytes = b64urlToBytes(raw);
  if (bytes.length !== KEY_LENGTH / 8) {
    throw new Error("Invalid sync key: expected a 256-bit key.");
  }
  return subtle().importKey(
    "jwk",
    { kty: "oct", k: raw, alg: "A256GCM", ext: true },
    { name: AES_ALG, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Short fingerprint for comparing keys across devices ("do both phones show
 * `a3f9…c21d`?"). SHA-256 of the raw key material, first 12 hex chars.
 * Reveals nothing usable — it can't decrypt anything.
 */
export async function keyFingerprint(key: CryptoKey): Promise<string> {
  const jwk = await subtle().exportKey("jwk", key);
  const raw = b64urlToBytes(jwk.k as string);
  const digest = await subtle().digest("SHA-256", raw.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export interface EncryptedPayload {
  /** base64url 96-bit IV */
  iv: string;
  /** base64url AES-GCM ciphertext */
  ciphertext: string;
}

/** Encrypt any JSON-serializable value. Fresh random IV every call. */
export async function encryptJson(
  key: CryptoKey,
  value: unknown,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = await subtle().encrypt(
    { name: AES_ALG, iv: iv.buffer as ArrayBuffer },
    key,
    plaintext.buffer as ArrayBuffer,
  );
  return {
    iv: bytesToB64url(iv),
    ciphertext: bytesToB64url(new Uint8Array(ct)),
  };
}

/** Decrypt a payload produced by `encryptJson`. Throws on wrong key / tampering. */
export async function decryptJson(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<unknown> {
  const iv = b64urlToBytes(payload.iv);
  const ct = b64urlToBytes(payload.ciphertext);
  if (iv.length !== IV_LENGTH_BYTES) throw new Error("Invalid IV length");
  const pt = await subtle().decrypt(
    { name: AES_ALG, iv: iv.buffer as ArrayBuffer },
    key,
    ct.buffer as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
