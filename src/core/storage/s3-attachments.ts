/**
 * S3-compatible AttachmentStore implementation.
 *
 * Loaded dynamically by `getAttachmentStore()` only when S3_* env vars are
 * set, so deployments without S3 never touch the AWS SDK. Works with AWS S3,
 * Cloudflare R2, MinIO, Backblaze B2, etc. — anything S3-compatible.
 *
 * SERVER ONLY — imports @aws-sdk/client-s3 (not installed until the
 * coordinator runs npm install; see the track manifest).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  sanitizeAttachmentKey,
  type AttachmentPutResult,
  type AttachmentStore,
  type ObjectStoreOptions,
} from "./attachments";

/** Alias kept for the S3 store; resolved via resolveObjectStoreOptions(). */
export type S3AttachmentOptions = ObjectStoreOptions;

export class S3AttachmentStore implements AttachmentStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly options: S3AttachmentOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  async put(
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<AttachmentPutResult> {
    const safe = sanitizeAttachmentKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safe,
        Body: data,
        ContentType: contentType,
      }),
    );
    return { key: safe };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const safe = sanitizeAttachmentKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safe }),
      );
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (err) {
      if ((err as { name?: string })?.name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const safe = sanitizeAttachmentKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: safe }),
    );
  }
}
