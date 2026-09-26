import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./stripe-client";

const SECRET = "whsec_test_secret_123";

function sign(rawBody: string, secret: string, timestamp: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyWebhookSignature(body, sign(body, SECRET, ts), SECRET)).toBe(true);
  });

  it("accepts one of several v1 signatures (key rotation)", () => {
    const body = "hello";
    const ts = Math.floor(Date.now() / 1000);
    const good = sign(body, SECRET, ts).split("v1=")[1];
    const header = `t=${ts},v1=deadbeef,v1=${good}`;
    expect(verifyWebhookSignature(body, header, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const ts = Math.floor(Date.now() / 1000);
    const header = sign(body, SECRET, ts);
    expect(verifyWebhookSignature(body + " ", header, SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = "payload";
    const ts = Math.floor(Date.now() / 1000);
    const header = sign(body, "whsec_wrong", ts);
    expect(verifyWebhookSignature(body, header, SECRET)).toBe(false);
  });

  it("rejects an expired timestamp (replay guard)", () => {
    const body = "payload";
    const old = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const header = sign(body, SECRET, old);
    expect(verifyWebhookSignature(body, header, SECRET)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifyWebhookSignature("x", "not-a-signature", SECRET)).toBe(false);
    expect(verifyWebhookSignature("x", "t=abc,v1=123", SECRET)).toBe(false);
    expect(verifyWebhookSignature("x", "", SECRET)).toBe(false);
  });
});
