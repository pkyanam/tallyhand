import { describe, expect, it } from "vitest";
import {
  NeonStorageProvider,
  normalizeNeonConnectionString,
} from "@/lib/db/neon-provider";
import { readOnlyIfViewer } from "@/lib/auth/read-only";
import { isEncryptedSyncStore } from "@/lib/db/sync-store";
import type { DbLike } from "@/lib/db/postgres-provider";

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

describe("Neon encrypted sync capability", () => {
  it("inherits the complete vault API through the viewer-role proxy", () => {
    const db = {} as DbLike;
    const ops = {} as ConstructorParameters<typeof NeonStorageProvider>[2];
    const neon = new NeonStorageProvider(db, "user_1", ops);

    expect(isEncryptedSyncStore(neon)).toBe(true);
    expect(
      isEncryptedSyncStore(readOnlyIfViewer(neon, "user_1")),
    ).toBe(true);
  });

  it("rejects partial stores that cannot answer sync status counts", () => {
    expect(
      isEncryptedSyncStore({
        upsertEncryptedEntities() {},
        listEncryptedEntitiesSince() {},
      }),
    ).toBe(false);
  });
});
