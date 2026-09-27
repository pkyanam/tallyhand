"use client";

import * as React from "react";
import { installDeleteHooks } from "@/lib/sync/delete-hooks";
import {
  ensureDataKey,
  getSyncStatus,
  isSyncEnabled,
} from "@/lib/sync/engine";

/**
 * Mounted once in the app layout. Two jobs:
 *
 * 1. First-sign-in key provisioning: when the server reports a real
 *    signed-in session, make sure this device holds a data-encryption key
 *    for that user — generating one on first sign-in when none exists. The
 *    key is created and stored in IndexedDB ONLY: sync is not enabled and
 *    nothing is transmitted. (Enabling is an explicit opt-in in Settings.)
 * 2. Installs the Dexie `deleting` hooks that record sync tombstones — but
 *    only when the user has opted into encrypted sync.
 *
 * Renders nothing. When sync is off, local-first behavior is untouched.
 */
export function SyncBootstrap() {
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSyncStatus();
        if (!cancelled && s.signedIn && s.userId) {
          await ensureDataKey(s.userId);
        }
      } catch {
        /* key provisioning is best-effort; the settings card surfaces errors */
      }
      if (!cancelled && isSyncEnabled()) installDeleteHooks();
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
