/**
 * Attachment storage abstraction (receipts, logos, future file uploads).
 *
 * Hosted deployments can point Tallyhand at any S3-compatible object store;
 * without S3 env vars it falls back to a local-disk store rooted at
 * `TALLYHAND_ATTACHMENTS_DIR` (default `<cwd>/.tallyhand-attachments`).
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

function s3EnvPresent(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY,
  );
}

/**
 * Server-side factory. Returns an S3 store when S3_* env vars are configured,
 * otherwise the local-disk default. The S3 module is dynamically imported so
 * the AWS SDK is never loaded (or bundled) for local-disk deployments.
 *
 * SERVER ONLY — never call from client components.
 */
export async function getAttachmentStore(
  env: Record<string, string | undefined> = process.env,
): Promise<AttachmentStore> {
  if (s3EnvPresent(env)) {
    const { S3AttachmentStore } = await import("./s3-attachments");
    const missing: string[] = [];
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      if (!env[k]) missing.push(k);
    }
    if (missing.length > 0) throw new Error(`S3 misconfigured, missing: ${missing.join(", ")}`);
    return new S3AttachmentStore({
      endpoint: env.S3_ENDPOINT as string,
      bucket: env.S3_BUCKET as string,
      accessKey: env.S3_ACCESS_KEY as string,
      secretKey: env.S3_SECRET_KEY as string,
      region: env.S3_REGION ?? "us-east-1",
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
    });
  }
  const dir =
    env.TALLYHAND_ATTACHMENTS_DIR ?? join(process.cwd(), ".tallyhand-attachments");
  return new LocalDiskAttachmentStore(dir);
}

/** Key convention for expense receipts. */
export function receiptKeyForExpense(expenseId: string, ext = "jpg"): string {
  return `receipts/${sanitizeAttachmentKey(expenseId)}.${ext.replace(/^\./, "")}`;
}
