import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAttachmentStore,
  LocalDiskAttachmentStore,
  receiptKeyForExpense,
  resolveObjectStoreOptions,
  sanitizeAttachmentKey,
} from "@/core/storage/attachments";

describe("sanitizeAttachmentKey", () => {
  it("accepts normal relative keys", () => {
    expect(sanitizeAttachmentKey("receipts/exp_123.jpg")).toBe(
      "receipts/exp_123.jpg",
    );
  });

  it("rejects traversal, absolute paths, and empty segments", () => {
    for (const bad of [
      "../escape",
      "a/../../escape",
      "/absolute",
      "a//b",
      "",
      "a/./b",
      "a\\..\\b",
    ]) {
      expect(() => sanitizeAttachmentKey(bad)).toThrow(/unsafe|required/);
    }
  });
});

describe("LocalDiskAttachmentStore", () => {
  let dir: string;
  let store: LocalDiskAttachmentStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tallyhand-attachments-"));
    store = new LocalDiskAttachmentStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips put → get → delete", async () => {
    const data = new Uint8Array([1, 2, 3, 255]);
    const put = await store.put("receipts/exp_1.jpg", data, "image/jpeg");
    expect(put.key).toBe("receipts/exp_1.jpg");

    const back = await store.get("receipts/exp_1.jpg");
    expect(back).toEqual(data);

    await store.delete("receipts/exp_1.jpg");
    expect(await store.get("receipts/exp_1.jpg")).toBeNull();
  });

  it("get/delete of missing keys are null-safe", async () => {
    expect(await store.get("nope.jpg")).toBeNull();
    await expect(store.delete("nope.jpg")).resolves.toBeUndefined();
  });

  it("refuses traversal on write", async () => {
    await expect(
      store.put("../evil", new Uint8Array([1]), "text/plain"),
    ).rejects.toThrow(/unsafe/);
  });
});

describe("getAttachmentStore", () => {
  it("returns a local-disk store without S3 env", async () => {
    const store = await getAttachmentStore({ PATH: "/usr/bin" });
    expect(store.kind).toBe("local-disk");
  });

  it("receiptKeyForExpense builds namespaced keys", () => {
    expect(receiptKeyForExpense("exp_abc")).toBe("receipts/exp_abc.jpg");
    expect(receiptKeyForExpense("exp_abc", "png")).toBe("receipts/exp_abc.png");
  });
});

describe("resolveObjectStoreOptions", () => {
  it("returns null with no object-store env (local-disk default)", () => {
    expect(resolveObjectStoreOptions({ PATH: "/usr/bin" })).toBeNull();
  });

  it("maps S3_* env vars to S3 options", () => {
    const opts = resolveObjectStoreOptions({
      S3_ENDPOINT: "https://s3.amazonaws.com",
      S3_BUCKET: "tally",
      S3_ACCESS_KEY: "ak",
      S3_SECRET_KEY: "sk",
      S3_REGION: "eu-west-1",
      S3_FORCE_PATH_STYLE: "1",
    });
    expect(opts).toEqual({
      endpoint: "https://s3.amazonaws.com",
      bucket: "tally",
      accessKey: "ak",
      secretKey: "sk",
      region: "eu-west-1",
      forcePathStyle: true,
    });
  });

  it("derives the R2 endpoint from R2_ACCOUNT_ID", () => {
    const opts = resolveObjectStoreOptions({
      R2_ACCOUNT_ID: "abc123",
      R2_BUCKET: "tally",
      R2_ACCESS_KEY_ID: "ak",
      R2_SECRET_ACCESS_KEY: "sk",
    });
    expect(opts).toEqual({
      endpoint: "https://abc123.r2.cloudflarestorage.com",
      bucket: "tally",
      accessKey: "ak",
      secretKey: "sk",
      region: "auto",
      forcePathStyle: true,
    });
  });

  it("prefers S3_* when both S3_* and R2_* are set", () => {
    const opts = resolveObjectStoreOptions({
      S3_ENDPOINT: "https://s3.amazonaws.com",
      S3_BUCKET: "s3bucket",
      S3_ACCESS_KEY: "ak",
      S3_SECRET_KEY: "sk",
      R2_ACCOUNT_ID: "abc123",
      R2_BUCKET: "r2bucket",
      R2_ACCESS_KEY_ID: "rak",
      R2_SECRET_ACCESS_KEY: "rsk",
    });
    expect(opts?.endpoint).toBe("https://s3.amazonaws.com");
    expect(opts?.bucket).toBe("s3bucket");
  });

  it("ignores incomplete R2 config (falls back to local disk)", () => {
    expect(
      resolveObjectStoreOptions({ R2_ACCOUNT_ID: "abc123" }),
    ).toBeNull();
  });
});

describe("getAttachmentStore with R2 env", () => {
  it("returns an s3-kind store for R2 env vars", async () => {
    const store = await getAttachmentStore({
      R2_ACCOUNT_ID: "abc123",
      R2_BUCKET: "tally",
      R2_ACCESS_KEY_ID: "ak",
      R2_SECRET_ACCESS_KEY: "sk",
    });
    expect(store.kind).toBe("s3");
  });
});
