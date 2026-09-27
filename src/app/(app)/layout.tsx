import type { ReactNode } from "react";
import { AppChrome } from "@/components/app/app-chrome";
import { LocalDataNotice } from "@/components/app/local-data-notice";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { StopPrompt } from "@/components/app/stop-prompt";
import { TimerHotkey } from "@/components/app/timer-hotkey";
import { SyncBootstrap } from "@/components/sync/sync-bootstrap";
import { LOCAL_USER_ID, tryResolveUserId } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The "your data stays in this browser" notice is only true when this
  // browser holds the only copy: local mode, or auth enabled but no
  // signed-in session (e.g. the "Use locally" choice). A signed-in user
  // syncs to the cloud vault, so the notice would be wrong for them.
  const userId = await tryResolveUserId();
  const showLocalNotice = userId === null || userId === LOCAL_USER_ID;
  const dataMode = showLocalNotice ? "local" : "cloud";

  return (
    <AppChrome dataMode={dataMode}>
      <SyncBootstrap />
      <div className="flex min-h-[100dvh]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-x-auto p-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+1rem))] sm:p-6 sm:pb-6">
            {showLocalNotice && <LocalDataNotice />}
            {children}
          </main>
        </div>
        <StopPrompt />
        <TimerHotkey />
      </div>
    </AppChrome>
  );
}
