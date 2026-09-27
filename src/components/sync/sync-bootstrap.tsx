"use client";

import * as React from "react";
import { installDeleteHooks } from "@/lib/sync/delete-hooks";
import {
  ensureDataKey,
  getSyncStatus,
  isSyncEnabled,
  setSyncEnabled,
  runSync,
} from "@/lib/sync/engine";

/**
 * Tracks whether the user explicitly turned sync off, so auto-enable on
 * sign-in doesn't fight their choice. Stored separately from the
 * `tallyhand.sync.enabled` flag (which `setSyncEnabled(false)` removes).
 */
const SYNC_OPTOUT_KEY = "tallyhand.sync.optout";

function hasOptedOut(): boolean {
  try {
    return window.localStorage.getItem(SYNC_OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSyncOptOut(optOut: boolean): void {
  try {
    if (optOut) window.localStorage.setItem(SYNC_OPTOUT_KEY, "1");
    else window.localStorage.removeItem(SYNC_OPTOUT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mounted once in the app layout. Three jobs:
 *
 * 1. First-sign-in key provisioning: when the server reports a real
 *    signed-in session, make sure this device holds a data-encryption key
 *    for that user — generating one on first sign-in when none exists.
 * 2. Native-cloud auto-sync: a signed-in session auto-enables encrypted
 *    sync (unless the user explicitly opted out in Settings), then runs
 *    an initial sync in the background. Signed-in Tallyhand behaves like
 *    a cloud app: data flows to the vault, share links work, and a second
 *    device picks everything up after importing the key.
 * 3. Installs the Dexie `deleting` hooks that record sync tombstones —
 *    but only when sync is enabled.
 *
 * Renders nothing. Signed-out (local-first) behavior is untouched.
 */
export function SyncBootstrap() {
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSyncStatus();
        if (!cancelled && s.signedIn && s.userId) {
          await ensureDataKey(s.userId);
          // Auto-enable on sign-in (first time only — respects opt-out).
          if (!isSyncEnabled() && !hasOptedOut() && s.syncSupported) {
            setSyncEnabled(true, s.userId);
            if (!cancelled) {
              // Best-effort initial push; the settings card surfaces errors.
              void runSync().catch(() => {});
            }
          }
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
