import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  newShareLinkId,
  sharePathForToken,
  signShareToken,
  verifyShareToken,
  type ShareTokenPayload,
} from "@/core/share";

const SECRET = "test-server-secret-32-chars-minimum!!";
const OTHER_SECRET = "a-different-server-secret-xxxxxxxxx";

function payload(overrides: Partial<ShareTokenPayload> = {}): ShareTokenPayload {
  return {
    v: 1,
    lid: newShareLinkId(),
    typ: "invoice",
    exp: Date.now() + 86_400_000,
    ...overrides,
  };
}

describe("share tokens", () => {
  it("round-trips sign → verify", () => {
    const p = payload();
    const token = signShareToken(p, SECRET);
    expect(token.startsWith("th1.")).toBe(true);
    expect(verifyShareToken(token, SECRET)).toEqual(p);
  });

  it("rejects tampered payloads", () => {
    const token = signShareToken(payload({ typ: "invoice" }), SECRET);
    const [prefix, body, sig] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64").toString()), typ: "timesheet" }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(verifyShareToken(`${prefix}.${tamperedBody}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects truncated/forged signatures", () => {
    const token = signShareToken(payload(), SECRET);
    const [prefix, body] = token.split(".");
    expect(verifyShareToken(`${prefix}.${body}.AAAA`, SECRET)).toBeNull();
    expect(verifyShareToken("th1.only-two", SECRET)).toBeNull();
    expect(verifyShareToken("not-a-token", SECRET)).toBeNull();
    expect(verifyShareToken("", SECRET)).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signShareToken(payload(), OTHER_SECRET);
    expect(verifyShareToken(token, SECRET)).toBeNull();
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    try {
      const token = signShareToken(payload({ exp: Date.now() + 1000 }), SECRET);
      vi.advanceTimersByTime(2000);
      expect(verifyShareToken(token, SECRET)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed JSON payloads", () => {
    // A token whose body is valid base64 but not a share payload.
    const body = Buffer.from("just a string")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const sig = createHmac("sha256", SECRET)
      .update(body, "utf8")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(verifyShareToken(`th1.${body}.${sig}`, SECRET)).toBeNull();
  });

  it("builds a URL-safe share path", () => {
    const token = signShareToken(payload(), SECRET);
    const path = sharePathForToken(token);
    expect(path.startsWith("/share/")).toBe(true);
    expect(decodeURIComponent(path.slice("/share/".length))).toBe(token);
  });

  it("requires a secret to sign", () => {
    expect(() => signShareToken(payload(), "")).toThrow(/secret/);
  });
});
