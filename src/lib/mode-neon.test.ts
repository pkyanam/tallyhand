import { describe, expect, it } from "vitest";
import {
  getConfig,
  isHosted,
  isNeonDatabaseUrl,
  parseStorage,
  validateConfig,
} from "@/lib/mode";

describe("neon storage mode", () => {
  it("parses TALLY_STORAGE=neon (case-insensitive)", () => {
    expect(parseStorage({ TALLY_STORAGE: "neon" })).toBe("neon");
    expect(parseStorage({ TALLY_STORAGE: "NEON" })).toBe("neon");
  });

  it("accepts the legacy TALLY_DB alias", () => {
    expect(parseStorage({ TALLY_DB: "neon" })).toBe("neon");
    expect(parseStorage({ TALLY_DB: "postgres" })).toBe("postgres");
    // Explicit TALLY_STORAGE wins over the alias.
    expect(
      parseStorage({ TALLY_STORAGE: "postgres", TALLY_DB: "neon" }),
    ).toBe("postgres");
  });

  it("auto-detects neon from a neon.tech DATABASE_URL when storage is unset", () => {
    expect(
      parseStorage({
        DATABASE_URL:
          "postgresql://user:pass@ep-123.us-east-2.aws.neon.tech/db?sslmode=require",
      }),
    ).toBe("neon");
    // A non-neon URL keeps the dexie default.
    expect(
      parseStorage({ DATABASE_URL: "postgresql://localhost:5432/app" }),
    ).toBe("dexie");
  });

  it("does not override an explicit TALLY_STORAGE with a neon URL", () => {
    expect(
      parseStorage({
        TALLY_STORAGE: "postgres",
        DATABASE_URL:
          "postgresql://user:pass@ep-123.us-east-2.aws.neon.tech/db?sslmode=require",
      }),
    ).toBe("postgres");
  });

  it("counts neon as hosted", () => {
    expect(isHosted({ TALLY_STORAGE: "neon" })).toBe(true);
    expect(getConfig({ TALLY_STORAGE: "neon" }).hosted).toBe(true);
  });

  it("requires DATABASE_URL for neon and validates it", () => {
    expect(validateConfig({ TALLY_STORAGE: "neon" })).toEqual(
      expect.arrayContaining([expect.stringMatching(/DATABASE_URL/)]) as unknown as string[],
    );
    expect(
      validateConfig({
        TALLY_STORAGE: "neon",
        DATABASE_URL: "postgresql://user:pass@ep-123.us-east-2.aws.neon.tech/db",
        TALLY_SHARE_SECRET: "share-secret-placeholder-32-chars-min",
      }),
    ).toEqual([]);
  });

  it("accepts builtin auth with neon storage", () => {
    expect(
      validateConfig({
        TALLY_AUTH: "builtin",
        TALLY_STORAGE: "neon",
        DATABASE_URL: "postgresql://example.invalid/db",
BUILTIN_AUTH_SECRET: "test-secret-32-chars-minimum-here!",
        APP_BASE_URL: "https://x.example",
TALLY_SHARE_SECRET: "share-secret-placeholder-32-chars-min",
      }),
    ).toEqual([]);
  });

  it("isNeonDatabaseUrl matches neon.tech hosts only", () => {
    expect(isNeonDatabaseUrl("postgresql://u:p@ep-1.aws.neon.tech/db")).toBe(true);
    expect(isNeonDatabaseUrl("postgresql://u:p@ep-1-pooler.aws.neon.tech/db")).toBe(true);
    expect(isNeonDatabaseUrl("postgresql://localhost:5432/db")).toBe(false);
    expect(isNeonDatabaseUrl("")).toBe(false);
    expect(isNeonDatabaseUrl("not-a-url")).toBe(false);
  });
});
