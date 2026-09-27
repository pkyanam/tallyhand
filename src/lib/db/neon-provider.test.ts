import { describe, expect, it } from "vitest";
import { normalizeNeonConnectionString } from "@/lib/db/neon-provider";

describe("normalizeNeonConnectionString", () => {
  it("rewrites -pooler hostnames to direct endpoints", () => {
    expect(
      normalizeNeonConnectionString(
        "postgresql://user:pass@ep-1234-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
      ),
    ).toBe(
      "postgresql://user:pass@ep-1234.us-east-2.aws.neon.tech/db?sslmode=require",
    );
  });

  it("leaves direct endpoints untouched", () => {
    const direct =
      "postgresql://user:pass@ep-1234.us-east-2.aws.neon.tech/db?sslmode=require";
    expect(normalizeNeonConnectionString(direct)).toBe(direct);
  });

  it("leaves non-neon URLs untouched", () => {
    const local = "postgresql://postgres:secret@localhost:5432/tallyhand";
    expect(normalizeNeonConnectionString(local)).toBe(local);
  });

  it("does not touch -pooler-like substrings in non-host positions", () => {
    const url =
      "postgresql://user:pass@ep-1234.us-east-2.aws.neon.tech/db?application_name=-pooler";
    expect(normalizeNeonConnectionString(url)).toBe(url);
  });
});
