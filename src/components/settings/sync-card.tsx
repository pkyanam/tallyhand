"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import {
  getSyncStatus,
  isSyncEnabled,
  setSyncEnabled,
  ensureDataKey,
  getDataKey,
  rotateDataKey,
  forgetDataKey,
  exportDataKey,
  importDataKey,
  keyFingerprint,
  runSync,
  reconcileAfterLocalReplace,
  type SyncStatus,
  type SyncResult,
} from "@/lib/sync/engine";
import { installDeleteHooks } from "@/lib/sync/delete-hooks";
import { markSyncOptOut } from "@/components/sync/sync-bootstrap";

export { reconcileAfterLocalReplace };

/**
 * Cloud Sync card for Settings. End-to-end encrypted sync (AES-GCM-256,
 * client-side): the server stores only ciphertext and can never read your
 * data.
 *
 * Shown only when the server reports a signed-in session; the card hides
 * itself entirely for signed-out users (local-first stays the default).
 */
export function SyncCard() {
  const { showNotice } = useAppChrome();
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [fingerprint, setFingerprint] = React.useState<string | null>(null);
  const [importValue, setImportValue] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const s = await getSyncStatus();
      setStatus(s);
      setStatusError(null);
      const on = isSyncEnabled() && !!s.signedIn;
      setEnabled(on);
      if (s.signedIn && s.userId) {
        const key = await getDataKey(s.userId).catch(() => null);
        setFingerprint(key ? await keyFingerprint(key) : null);
      }
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Couldn't reach the sync service.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const userId = status?.userId ?? null;

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const handleToggle = (on: boolean) =>
    withBusy(on ? "enabling" : "disabling", async () => {
      if (!userId) return;
      if (on) {
        await ensureDataKey(userId);
        setSyncEnabled(true, userId);
        markSyncOptOut(false);
        installDeleteHooks();
        setEnabled(true);
        showNotice("Encrypted sync on — running first sync…");
        const r = await runSync();
        setLastResult(r);
        if (r.status === "ok") {
          setLastSyncAt(new Date().toLocaleString());
          showNotice(
            `Sync complete — pushed ${r.pushed ?? 0}, applied ${r.applied ?? 0}.`,
          );
        } else {
          showNotice(`Sync: ${r.reason ?? r.status}`);
        }
      } else {
        setSyncEnabled(false);
        markSyncOptOut(true);
        setEnabled(false);
        showNotice("Sync off. Your key stays on this device — re-enable anytime.");
      }
    });

  const handleCopyKey = () =>
    withBusy("copying", async () => {
      if (!userId) return;
      const key = await getDataKey(userId);
      if (!key) {
        showNotice("No key on this device yet — enable sync first.");
        return;
      }
      const exported = await exportDataKey(key);
      await navigator.clipboard.writeText(exported);
      showNotice("Sync key copied. Paste it on your other device to link it.");
    });

  const handleImportKey = () =>
    withBusy("importing", async () => {
      if (!userId) return;
      const key = await importDataKey(importValue);
      const { storeSyncKey } = await import("@/lib/sync/sync-db");
      await storeSyncKey(userId, await exportDataKey(key));
      setImportValue("");
      showNotice("Key imported — this device can now read your synced data.");
    });

  const handleRotate = () =>
    withBusy("rotating", async () => {
      if (!userId) return;
      if (
        !window.confirm(
          "Generate a NEW sync key? Snapshots already in the cloud were encrypted with the old key and will become UNREADABLE — including on your other devices, until you import the new key there. Only do this if the old key is compromised or lost.",
        )
      )
        return;
      await rotateDataKey(userId);
      showNotice("New key generated. Import it on your other devices.");
    });

  const handleForget = () =>
    withBusy("forgetting", async () => {
      if (!userId) return;
      if (
        !window.confirm(
          "Forget this device's sync key? You won't be able to read cloud data on this device until you import the key again. The cloud copies stay encrypted and untouched.",
        )
      )
        return;
      await forgetDataKey(userId);
      setSyncEnabled(false);
      markSyncOptOut(true);
      setEnabled(false);
      showNotice("Key forgotten on this device.");
    });

  const handleSyncNow = () =>
    withBusy("syncing", async () => {
      const r = await runSync();
      setLastResult(r);
      if (r.status === "ok") {
        setLastSyncAt(new Date().toLocaleString());
        const dec = r.decryptErrors
          ? ` (${r.decryptErrors} snapshot(s) couldn't be decrypted — wrong key?)`
          : "";
        showNotice(`Sync complete — pushed ${r.pushed ?? 0}, applied ${r.applied ?? 0}.${dec}`);
      } else {
        showNotice(`Sync: ${r.reason ?? r.status}`);
      }
    });

  if (statusError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cloud sync</CardTitle>
          <CardDescription>{statusError}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cloud sync</CardTitle>
          <CardDescription>Checking sync availability…</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!status.signedIn) return null;

  const unsupported = !status.syncSupported;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud sync</CardTitle>
        <CardDescription>
          End-to-end encrypted backup across your devices. Your data is
          encrypted on this device (AES-GCM-256) — the server stores only
          ciphertext and can never read it. Sync turns on automatically when
          you sign in; switch it off here any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {unsupported ? (
          <p className="text-sm text-muted-foreground">
            This server stores data with <code className="text-xs">{status.storage}</code>,
            which doesn&apos;t support the encrypted sync vault. Sync needs{" "}
            <code className="text-xs">TALLY_STORAGE=postgres</code> or{" "}
            <code className="text-xs">neon</code>.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Encrypted sync</div>
                <div className="text-xs text-muted-foreground">
                  {status.cloudCount != null && status.cloudCount > 0
                    ? `${status.cloudCount} encrypted snapshot(s) in the cloud vault.`
                    : "Nothing in the cloud vault yet."}
                  {lastSyncAt ? ` Last synced ${lastSyncAt}.` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sync-enabled"
                  checked={enabled}
                  disabled={busy !== null}
                  onCheckedChange={(v) => void handleToggle(v === true)}
                  aria-label="Enable encrypted sync"
                />
                <Label htmlFor="sync-enabled" className="text-sm">
                  {enabled ? "On" : "Off"}
                </Label>
              </div>
            </div>

            {enabled && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void handleSyncNow()}
                  >
                    {busy === "syncing" ? "Syncing…" : "Sync now"}
                  </Button>
                  {lastResult && lastResult.status !== "disabled" && (
                    <span
                      className={
                        lastResult.status === "ok"
                          ? "text-xs text-muted-foreground"
                          : "text-xs text-destructive"
                      }
                      role="status"
                    >
                      {lastResult.status === "ok"
                        ? `Synced — ${lastResult.pushed ?? 0} pushed, ${lastResult.applied ?? 0} applied.${
                            lastResult.restAdopted
                              ? ` ${lastResult.restAdopted} row(s) adopted from the API.`
                              : ""
                          }`
                        : (lastResult.reason ?? "Sync failed.")}
                    </span>
                  )}
                  {lastResult?.restError && (
                    <p className="text-xs text-destructive" role="alert">
                      API sync issue: {lastResult.restError} Open the browser
                      console for details.
                    </p>
                  )}
                </div>

                <div className="border-t pt-3">
                  <div className="text-sm font-medium">Sync key</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fingerprint ? (
                      <>
                        This device&apos;s key fingerprint:{" "}
                        <code className="text-xs">{fingerprint}</code> — both
                        devices should show the same fingerprint after you
                        import the key.
                      </>
                    ) : (
                      "No key on this device yet."
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || !fingerprint}
                      onClick={() => void handleCopyKey()}
                    >
                      {busy === "copying" ? "Copying…" : "Copy key"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void handleRotate()}
                    >
                      New key…
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void handleForget()}
                    >
                      Forget key…
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    <Label htmlFor="sync-key-import">
                      Import a key from another device
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="sync-key-import"
                        value={importValue}
                        onChange={(e) => setImportValue(e.target.value)}
                        placeholder="Paste the base64 sync key…"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null || !importValue.trim()}
                        onClick={() => void handleImportKey()}
                      >
                        {busy === "importing" ? "Importing…" : "Import"}
                      </Button>
                    </div>
                  </div>
                </div>

                <p className="border-t pt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Recovery, honestly:</span>{" "}
                  your key lives only on your devices — never on the server.
                  If you lose every copy of the key, your cloud data is
                  unreadable <em>forever</em>; nobody can recover it for you,
                  not even the server operator. Copy the key to a second
                  device (or a password manager) <em>before</em> you need it.
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
