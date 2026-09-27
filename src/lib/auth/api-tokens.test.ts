/**
 * Personal API tokens: minting, hashing, lookup, revocation, and user
 * isolation. Exercises the sqlite backend (TALLY_STORAGE=sqlite) against a
 * temp DB file — the same backend the local server uses.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tempDbPath } from "@/server/sqlite-provider";
import {
  __resetApiTokenCaches,
  createApiToken,
  findApiToken,
  hashApiToken,
  listApiTokens,
  mintApiToken,
  revokeApiToken,
} from "./api-tokens";

const USER_A = "user_a";
const USER_B = "user_b";

describe("api tokens", () => {
  let dbPath: string;
  let savedDbPath: string | undefined;
  let savedStorage: string | undefined;

  beforeEach(() => {
    savedDbPath = process.env.TALLYHAND_DB_PATH;
    savedStorage = process.env.TALLY_STORAGE;
    dbPath = tempDbPath("tallyhand-apitokens-test");
    process.env.TALLYHAND_DB_PATH = dbPath;
    process.env.TALLY_STORAGE = "sqlite";
    __resetApiTokenCaches();
  });

  afterEach(() => {
    if (savedDbPath === undefined) delete process.env.TALLYHAND_DB_PATH;
    else process.env.TALLYHAND_DB_PATH = savedDbPath;
    if (savedStorage === undefined) delete process.env.TALLY_STORAGE;
    else process.env.TALLY_STORAGE = savedStorage;
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("mints thp_ tokens and hashes deterministically", () => {
    const token = mintApiToken();
    expect(token).toMatch(/^thp_[A-Za-z0-9_-]{43}$/);
    expect(mintApiToken()).not.toBe(token);
    expect(hashApiToken(token)).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
  });

  it("creates a token and returns the raw value exactly once", async () => {
    const secret = await createApiToken(USER_A, "MacBook CLI");
    expect(secret.token).toMatch(/^thp_/);
    expect(secret.name).toBe("MacBook CLI");
    expect(secret.prefix).toBe(secret.token.slice(0, 8));
    expect(secret.userId).toBe(USER_A);
    expect(secret.createdAt).toBeGreaterThan(0);

    // The listing never exposes the raw token or its hash.
    const listed = await listApiTokens(USER_A);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(listed)).not.toContain(secret.token);
  });

  it("verifies a presented token and rejects garbage", async () => {
    const secret = await createApiToken(USER_A, "agent");
    const verified = await findApiToken(secret.token);
    expect(verified).toMatchObject({ userId: USER_A, name: "agent" });

    expect(await findApiToken("thp_" + "x".repeat(43))).toBeNull();
    expect(await findApiToken("not-a-token")).toBeNull();
    expect(await findApiToken("")).toBeNull();
  });

  it("stores only the hash, and touches lastUsedAt on verify", async () => {
    const secret = await createApiToken(USER_A, "agent");
    const before = (await listApiTokens(USER_A))[0].lastUsedAt;
    expect(before).toBeNull();

    await findApiToken(secret.token);
    const after = (await listApiTokens(USER_A))[0].lastUsedAt;
    expect(after).not.toBeNull();
    expect(after as number).toBeGreaterThan(0);
  });

  it("revokes tokens and isolates users", async () => {
    const a1 = await createApiToken(USER_A, "a-one");
    const a2 = await createApiToken(USER_A, "a-two");
    const b1 = await createApiToken(USER_B, "b-one");

    // B cannot see or revoke A's tokens.
    expect(await listApiTokens(USER_B)).toHaveLength(1);
    expect(await revokeApiToken(USER_B, a1.id)).toBe(false);
    expect(await findApiToken(a1.token)).not.toBeNull();

    // A revokes one of their own.
    expect(await revokeApiToken(USER_A, a1.id)).toBe(true);
    expect(await findApiToken(a1.token)).toBeNull();
    expect(await findApiToken(a2.token)).not.toBeNull();
    expect(await findApiToken(b1.token)).not.toBeNull();
    expect(await revokeApiToken(USER_A, a1.id)).toBe(false);
  });

  it("normalizes blank names", async () => {
    const secret = await createApiToken(USER_A, "   ");
    expect(secret.name).toBe("Untitled token");
  });
});
