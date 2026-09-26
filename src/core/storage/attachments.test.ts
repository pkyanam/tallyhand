import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAttachmentStore,
  LocalDiskAttachmentStore,
  receiptKeyForExpense,
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
