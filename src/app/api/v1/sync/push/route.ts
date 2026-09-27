/**
 * POST /api/v1/sync/push — upload encrypted entity snapshots.
 *
 * Body: `{ entities: [{ entityType, entityId, iv, ciphertext, updatedAt, deleted }] }`
 *
 * The server stores the payload VERBATIM and never sees plaintext: `iv`
 * and `ciphertext` are opaque base64 produced client-side with the user's
 * AES-GCM-256 data key. Structural validation only (known entity type,
 * non-empty strings, finite updatedAt) happens in the provider.
 *
 * Last-write-wins: a snapshot is stored only when its `updatedAt` is
 * strictly newer than the stored one. The response reports
 * `{ written, received }` so the client can distinguish "stored" from
 * "dropped as stale/invalid".
 *
 * Auth: signed-in session (browser) or v1 API token (machine), via
 * `requireSyncAuth`; per-user scoping comes from `getServerProvider()`.
 * Requires the `x-tallyhand-sync: 1` header (CSRF guard, see sync-auth.ts).
 */
import { z } from "zod";
import { getServerProvider } from "@/server/provider";
import { badRequest, json, ok } from "@/server/http";
import { isEncryptedSyncStore, SYNC_ENTITY_TYPES } from "@/lib/db/sync-store";
import { requireSyncAuth, requireSyncHeader } from "../../_lib/sync-auth";

export const runtime = "nodejs";

const pushEntitySchema = z.object({
  entityType: z.enum(SYNC_ENTITY_TYPES),
  entityId: z.string().min(1).max(256),
  iv: z.string().min(1).max(64),
  ciphertext: z.string().min(1).max(10_000_000),
  updatedAt: z.number().finite(),
  deleted: z.boolean(),
});

const pushBodySchema = z.object({
  entities: z.array(pushEntitySchema).max(5000),
});

export async function POST(req: Request) {
  const headerErr = requireSyncHeader(req);
  if (headerErr) return headerErr;
  const auth = await requireSyncAuth(req);
  if (auth instanceof Response) return auth;

  const provider = getServerProvider();
  if (!isEncryptedSyncStore(provider)) {
    return json(
      {
        error: {
          code: "not_supported",
          message:
            "Encrypted sync needs TALLY_STORAGE=postgres or neon (this server stores data elsewhere).",
        },
      },
      501,
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = pushBodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid sync push payload", parsed.error.issues);
  }

  try {
    const written = await provider.upsertEncryptedEntities(parsed.data.entities);
    return ok({ written, received: parsed.data.entities.length });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403) {
      return json(
        { error: { code: "forbidden", message: "Viewers cannot push sync data" } },
        403,
      );
    }
    throw err;
  }
}
