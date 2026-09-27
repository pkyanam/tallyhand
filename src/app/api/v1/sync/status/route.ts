/**
 * GET /api/v1/sync/status — sync availability probe (no auth required).
 *
 * The settings UI calls this on load to decide whether to show the
 * Cloud Sync card: `{ signedIn }` tells the client a session exists,
 * `syncSupported` tells it the server storage can hold the encrypted
 * vault (postgres/neon). The response never leaks another user's data —
 * `userId`/`cloudCount` are only present for the caller's own session.
 */
import { getServerProvider } from "@/server/provider";
import { json, ok } from "@/server/http";
import { getConfig } from "@/lib/mode";
import { tryResolveSyncUserId } from "@/lib/auth/session";
import { isEncryptedSyncStore } from "@/lib/db/sync-store";

export const runtime = "nodejs";

export async function GET() {
  const userId = await tryResolveSyncUserId();
  const { storage } = getConfig();
  const base = {
    signedIn: userId !== null,
    storage,
    syncSupported: false as boolean,
  };
  if (!userId) return ok(base);

  const provider = getServerProvider();
  if (!isEncryptedSyncStore(provider)) return ok(base);

  let cloudCount = 0;
  try {
    cloudCount = await provider.countEncryptedEntities();
  } catch {
    // A vault read failure must not break the settings page; the card
    // shows "unavailable" and the user can retry from Sync Now.
    return json(
      {
        data: { ...base, syncSupported: true, vaultError: true },
      },
      200,
    );
  }
  return ok({ ...base, syncSupported: true, userId, cloudCount });
}
