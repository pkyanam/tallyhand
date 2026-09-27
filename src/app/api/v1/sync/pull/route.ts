/**
 * GET /api/v1/sync/pull?since=<ms>&types=<csv> — download encrypted snapshots.
 *
 * Returns `{ data: { entities: [...], truncated, serverTime } }`: up to
 * 5000 snapshots for the authenticated user with `updatedAt` strictly
 * greater than `since`, ascending by (updatedAt, entityId). `truncated` is
 * true when more rows may exist past the cap. The client pages with the
 * `afterId` keyset cursor: pass the last row's entityId together with
 * `since` = its updatedAt to continue exactly where the page stopped
 * (see `src/lib/sync/engine.ts`).
 *
 * `types` optionally restricts to a comma-separated subset of entity types
 * (unknown values are ignored). Everything stays ciphertext: the client
 * decrypts with its local data key.
 *
 * Auth: signed-in session (browser) or v1 API token (machine), via
 * `requireSyncAuth`; per-user scoping comes from `getServerProvider()`.
 * Read-only, so no CSRF header is needed (same-origin JSON is not
 * cross-site readable).
 */
import { getServerProvider } from "@/server/provider";
import { badRequest, json, ok } from "@/server/http";
import {
  isEncryptedSyncStore,
  isSyncEntityType,
  type SyncEntityType,
} from "@/lib/db/sync-store";
import { requireSyncAuth } from "../../_lib/sync-auth";

export const runtime = "nodejs";

const MAX_PULL_ROWS = 5000;

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw === null ? 0 : Number(sinceRaw);
  if (!Number.isFinite(since) || since < 0) {
    return badRequest("Invalid ?since= (ms epoch number expected)");
  }
  const types = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(isSyncEntityType);
  const entityTypes: SyncEntityType[] | undefined =
    types.length > 0 ? types : undefined;
  // Keyset cursor for paging: `afterId` is the entityId of the last row of
  // the previous page, whose updatedAt equals `since`.
  const afterId = url.searchParams.get("afterId");
  const after =
    afterId && afterId.length <= 256
      ? { updatedAt: since, entityId: afterId }
      : undefined;

  // Fetch one past the cap so the client knows whether more rows exist.
  const rows = await provider.listEncryptedEntitiesSince(
    since,
    entityTypes,
    MAX_PULL_ROWS + 1,
    after,
  );
  const truncated = rows.length > MAX_PULL_ROWS;
  const entities = rows.slice(0, MAX_PULL_ROWS).map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    iv: r.iv,
    ciphertext: r.ciphertext,
    updatedAt: r.updatedAt,
    deleted: r.deleted,
  }));
  return ok({ entities, truncated, serverTime: Date.now() });
}
