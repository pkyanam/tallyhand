import { describe, expect, it } from "vitest";
import {
  getConfig,
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
