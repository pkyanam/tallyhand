/**
 * Attachment storage abstraction (receipts, logos, future file uploads).
 *
 * Hosted deployments can point Tallyhand at any S3-compatible object store;
 * without S3/R2 env vars it falls back to a local-disk store rooted at
 * `TALLYHAND_ATTACHMENTS_DIR` (default `<cwd>/.tallyhand-attachments`).
 *
 * Configure ONE of:
 * - S3_* — S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY
 *   (+ optional S3_REGION, S3_FORCE_PATH_STYLE=1): AWS S3, MinIO, B2, …
 * - R2_* — R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID /
 *   R2_SECRET_ACCESS_KEY (+ optional R2_REGION): Cloudflare R2. The endpoint
 *   is derived as `https://<account>.r2.cloudflarestorage.com`. S3_* wins
 *   when both are set.
 *
 * Keys are caller-chosen, URL-safe relative paths such as
 * `receipts/<expenseId>.jpg`. Implementations must never let a key escape
 * the store root (path traversal is rejected).
 *
 * - `LocalDiskAttachmentStore` — default, zero dependencies.
 * - `S3AttachmentStore` — in `./s3-attachments` (imports @aws-sdk/client-s3;
 *   only loaded when S3 env is configured).
 *
 * Wire receipts through `getAttachmentStore()` on the server; never import
 * this module's S3 implementation from client components.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface AttachmentPutResult {
  /** Storage key the object was written under (echoes the requested key). */
  key: string;
  /** Public URL when the store serves one (S3 with public bucket); otherwise undefined. */
  url?: string;
}

export interface AttachmentStore {
  readonly kind: "local-disk" | "s3";
  put(key: string, data: Uint8Array, contentType: string): Promise<AttachmentPutResult>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Reject absolute keys and anything that escapes the store root. */
export function sanitizeAttachmentKey(key: string): string {
  if (!key || typeof key !== "string") throw new Error("attachment key required");
  if (key.startsWith("/") || /^[a-zA-Z]:/.test(key))
    throw new Error(`unsafe attachment key: ${key}`);
  const normalized = key.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    parts.some((p) => p === "" || p === "." || p === "..") ||
    /[\0]/.test(normalized)
  ) {
    throw new Error(`unsafe attachment key: ${key}`);
  }
  return parts.join("/");
}

export class LocalDiskAttachmentStore implements AttachmentStore {
  readonly kind = "local-disk" as const;
  constructor(private readonly rootDir: string) {}

  private pathFor(key: string): string {
    const safe = sanitizeAttachmentKey(key);
    const full = resolve(this.rootDir, safe);
    const root = resolve(this.rootDir) + sep;
    if (!full.startsWith(root)) throw new Error(`unsafe attachment key: ${key}`);
    return full;
  }

  // Local disk stores bytes only; contentType is part of the interface
  // (used by the S3 backend) but has no on-disk representation here.
  async put(
    key: string,
    data: Uint8Array,
    _contentType: string,
  ): Promise<AttachmentPutResult> {
    void _contentType;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key: sanitizeAttachmentKey(key) };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.pathFor(key));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key), { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw err;
    }
  }
}

/** S3-compatible connection options, resolved from S3_* or R2_* env vars. */
export interface ObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  forcePathStyle?: boolean;
}

function s3EnvPresent(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY,
  );
}

function r2EnvPresent(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_BUCKET &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY,
  );
}

/**
 * Resolve object-storage options from the environment. Two interchangeable
 * spellings, S3_* wins when both are set:
 *
 * - `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`
 *   (+ optional `S3_REGION`, `S3_FORCE_PATH_STYLE=1`) — any S3-compatible
 *   store (AWS S3, MinIO, Backblaze B2, …).
 * - `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` /
 *   `R2_SECRET_ACCESS_KEY` (+ optional `R2_REGION`) — Cloudflare R2. The
 *   endpoint is derived as `https://<account>.r2.cloudflarestorage.com`.
 *
 * Returns null when neither is configured (local-disk default applies).
 */
export function resolveObjectStoreOptions(
  env: Record<string, string | undefined>,
): ObjectStoreOptions | null {
  if (s3EnvPresent(env)) {
    return {
      endpoint: env.S3_ENDPOINT as string,
      bucket: env.S3_BUCKET as string,
      accessKey: env.S3_ACCESS_KEY as string,
      secretKey: env.S3_SECRET_KEY as string,
      region: env.S3_REGION ?? "us-east-1",
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
    };
  }
  if (r2EnvPresent(env)) {
    return {
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET as string,
      accessKey: env.R2_ACCESS_KEY_ID as string,
      secretKey: env.R2_SECRET_ACCESS_KEY as string,
      region: env.R2_REGION ?? "auto",
      forcePathStyle: true,
    };
  }
  return null;
}

/**
 * Server-side factory. Returns an S3 store when S3_* or R2_* env vars are
 * configured, otherwise the local-disk default. The S3 module is
 * dynamically imported so the AWS SDK is never loaded (or bundled) for
 * local-disk deployments.
 *
 * SERVER ONLY — never call from client components.
 */
export async function getAttachmentStore(
  env: Record<string, string | undefined> = process.env,
): Promise<AttachmentStore> {
  const options = resolveObjectStoreOptions(env);
  if (options) {
    const { S3AttachmentStore } = await import("./s3-attachments");
    return new S3AttachmentStore(options);
  }
  const dir =
    env.TALLYHAND_ATTACHMENTS_DIR ?? join(process.cwd(), ".tallyhand-attachments");
  return new LocalDiskAttachmentStore(dir);
}

/** Key convention for expense receipts. */
export function receiptKeyForExpense(expenseId: string, ext = "jpg"): string {
  return `receipts/${sanitizeAttachmentKey(expenseId)}.${ext.replace(/^\./, "")}`;
}
