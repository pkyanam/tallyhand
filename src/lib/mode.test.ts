import { describe, expect, it } from "vitest";
import {
  clerkPublishableKey,
  effectiveAuth,
  getConfig,
  hasClerkKeys,
  isHosted,
  parseAuth,
  parseStorage,
  requireValidConfig,
  validateConfig,
} from "@/lib/mode";

describe("env contract", () => {
  it("defaults to dexie storage + no auth (local)", () => {
    expect(getConfig({})).toEqual({ storage: "dexie", auth: "none", hosted: false });
    expect(parseStorage({ TALLY_STORAGE: "banana" })).toBe("dexie");
    expect(parseAuth({ TALLY_AUTH: "banana" })).toBe("none");
  });

  it("parses storage and auth case-insensitively", () => {
    expect(parseStorage({ TALLY_STORAGE: "Postgres" })).toBe("postgres");
    expect(parseStorage({ TALLY_STORAGE: "CONVEX" })).toBe("convex");
    expect(parseAuth({ TALLY_AUTH: "Clerk" })).toBe("clerk");
    expect(parseAuth({ TALLY_AUTH: "BUILTIN" })).toBe("builtin");
  });

  it("derives hosted from shared storage or any real auth", () => {
    expect(isHosted({ TALLY_STORAGE: "postgres" })).toBe(true);
    expect(isHosted({ TALLY_STORAGE: "convex" })).toBe(true);
    expect(isHosted({ TALLY_AUTH: "clerk" })).toBe(true);
    expect(isHosted({ TALLY_AUTH: "builtin", TALLY_STORAGE: "sqlite" })).toBe(true);
    expect(isHosted({})).toBe(false);
    expect(isHosted({ TALLY_STORAGE: "sqlite", TALLY_AUTH: "none" })).toBe(false);
  });

  it("validates provider-specific env vars", () => {
    // postgres without DATABASE_URL
    expect(validateConfig({ TALLY_STORAGE: "postgres" })).toEqual(
      expect.arrayContaining([expect.stringMatching(/DATABASE_URL/)]),
    );
    // convex without CONVEX_URL
    expect(validateConfig({ TALLY_STORAGE: "convex" })).toEqual(
      expect.arrayContaining([expect.stringMatching(/CONVEX_URL/)]),
    );
    // clerk without keys
    expect(validateConfig({ TALLY_AUTH: "clerk" })).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/CLERK_PUBLISHABLE_KEY/),
        expect.stringMatching(/CLERK_SECRET_KEY/),
      ]),
    );
    // builtin requires postgres storage + secret + base url
    expect(
      validateConfig({
        TALLY_AUTH: "builtin",
        TALLY_STORAGE: "sqlite",
        BUILTIN_AUTH_SECRET: "x".repeat(32),
        APP_BASE_URL: "https://x.example",
        TALLY_SHARE_SECRET: "y".repeat(32),
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/requires TALLY_STORAGE=postgres/)]));

    // fully valid hosted postgres+builtin config
    const good = {
      TALLY_STORAGE: "postgres",
      TALLY_AUTH: "builtin",
      DATABASE_URL: "postgresql://u:p@h:5432/db",
      BUILTIN_AUTH_SECRET: "x".repeat(32),
      APP_BASE_URL: "https://x.example",
      TALLY_SHARE_SECRET: "y".repeat(32),
    };
    expect(validateConfig(good)).toEqual([]);
    expect(() => requireValidConfig(good)).not.toThrow();

    // hosted without share secret
    expect(
      validateConfig({ TALLY_STORAGE: "postgres", DATABASE_URL: "x" }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/TALLY_SHARE_SECRET/)]));

    // local default is valid with zero config
    expect(validateConfig({})).toEqual([]);
  });

  it("requireValidConfig throws a readable message", () => {
    expect(() => requireValidConfig({ TALLY_STORAGE: "postgres" })).toThrow(
      /Invalid Tallyhand configuration/,
    );
  });
});

describe("clerk auto-detect", () => {
  const KEYS = {
    CLERK_PUBLISHABLE_KEY: "pk_test_abc",
    CLERK_SECRET_KEY: "sk_test_def",
  };

  it("resolves the publishable key from either env name", () => {
    expect(clerkPublishableKey({ CLERK_PUBLISHABLE_KEY: "pk_a" })).toBe("pk_a");
    expect(
      clerkPublishableKey({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_b" }),
    ).toBe("pk_b");
    // runtime server var wins over the NEXT_PUBLIC alias
    expect(
      clerkPublishableKey({
        CLERK_PUBLISHABLE_KEY: "pk_a",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_b",
      }),
    ).toBe("pk_a");
    expect(clerkPublishableKey({})).toBe("");
  });

  it("detects complete vs incomplete key pairs", () => {
    expect(hasClerkKeys(KEYS)).toBe(true);
    expect(hasClerkKeys({ CLERK_PUBLISHABLE_KEY: "pk_test_abc" })).toBe(false);
    expect(hasClerkKeys({ CLERK_SECRET_KEY: "sk_test_def" })).toBe(false);
    expect(hasClerkKeys({})).toBe(false);
  });

  it("effectiveAuth: explicit knob wins; keys auto-detect only when unset", () => {
    // byte-for-byte local behavior without keys
    expect(effectiveAuth({})).toBe("none");
    expect(effectiveAuth({ TALLY_AUTH: "none" })).toBe("none");
    // auto-detect: keys present, TALLY_AUTH absent entirely
    expect(effectiveAuth(KEYS)).toBe("clerk");
    // explicit none beats keys (single-user local stays untouched)
    expect(effectiveAuth({ TALLY_AUTH: "none", ...KEYS })).toBe("none");
    // explicit modes always win
    expect(effectiveAuth({ TALLY_AUTH: "builtin", ...KEYS })).toBe("builtin");
    expect(effectiveAuth({ TALLY_AUTH: "clerk" })).toBe("clerk");
    // unknown knob value → none, never auto-detect
    expect(effectiveAuth({ TALLY_AUTH: "banana", ...KEYS })).toBe("none");
    // parseAuth itself is untouched (explicit knob only)
    expect(parseAuth(KEYS)).toBe("none");
  });

  it("reports the same effective auth mode to config consumers and validation", () => {
    expect(getConfig(KEYS)).toMatchObject({ auth: "clerk", hosted: true });
    expect(validateConfig(KEYS)).toEqual(expect.arrayContaining([expect.stringMatching(/TALLY_SHARE_SECRET/)]));
    expect(getConfig({ ...KEYS, TALLY_AUTH: "none" })).toMatchObject({ auth: "none", hosted: false });
  });

  it("validateConfig accepts the NEXT_PUBLIC publishable key alias", () => {
    const problems = validateConfig({
      TALLY_AUTH: "clerk",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
      CLERK_SECRET_KEY: "sk_test_def",
    });
    expect(problems.filter((p) => /PUBLISHABLE/.test(p))).toEqual([]);
  });
});
