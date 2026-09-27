/**
 * Crypto round-trip tests for E2E encrypted sync.
 *
 * - generate → export → import → encrypt → decrypt returns the original.
 * - Every encryption uses a fresh IV (same plaintext → different bytes).
 * - Decryption with the wrong key fails (AES-GCM authentication).
 * - Tampered ciphertext fails authentication.
 * - Malformed key imports are rejected with clear errors.
 */
import { describe, expect, it } from "vitest";
import {
  generateDataKey,
  exportDataKey,
  importDataKey,
  keyFingerprint,
  encryptJson,
  decryptJson,
} from "@/lib/sync/crypto";

describe("sync crypto", () => {
  it("round-trips: generate → export → import → encrypt → decrypt", async () => {
    const key = await generateDataKey();
    const exported = await exportDataKey(key);
    expect(exported).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const imported = await importDataKey(exported);
    const payload = { id: "tsk_1", name: "Consulting", tags: ["billable"] };
    const enc = await encryptJson(imported, payload);
    expect(enc.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(enc.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);

    // Decrypt with the ORIGINAL key object — export/import must preserve it.
    expect(await decryptJson(key, enc)).toEqual(payload);
  });

  it("uses a fresh IV for every encryption", async () => {
    const key = await generateDataKey();
    const a = await encryptJson(key, { v: 1 });
    const b = await encryptJson(key, { v: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptJson(key, a)).toEqual({ v: 1 });
    expect(await decryptJson(key, b)).toEqual({ v: 1 });
  });

  it("fails closed on the wrong key", async () => {
    const keyA = await generateDataKey();
    const keyB = await generateDataKey();
    const enc = await encryptJson(keyA, { secret: "data" });
    await expect(decryptJson(keyB, enc)).rejects.toThrow();
  });

  it("fails closed on tampered ciphertext", async () => {
    const key = await generateDataKey();
    const enc = await encryptJson(key, { secret: "data" });
    const tampered = {
      ...enc,
      ciphertext:
        enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith("A") ? "BB" : "AA"),
    };
    await expect(decryptJson(key, tampered)).rejects.toThrow();
  });

  it("rejects malformed key imports", async () => {
    await expect(importDataKey("")).rejects.toThrow(/sync key/i);
    await expect(importDataKey("not-a-key")).rejects.toThrow();
    await expect(importDataKey("!!!invalid base64!!!")).rejects.toThrow();
  });

  it("produces a stable fingerprint that differs per key", async () => {
    const a = await generateDataKey();
    const b = await generateDataKey();
    const fa = await keyFingerprint(a);
    expect(fa).toMatch(/^[0-9a-f]{12}$/);
    expect(await keyFingerprint(a)).toBe(fa);
    expect(await keyFingerprint(b)).not.toBe(fa);
  });
});
