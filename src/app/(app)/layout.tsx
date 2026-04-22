import type { ReactNode } from "react";
import { AppChrome } from "@/components/app/app-chrome";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { StopPrompt } from "@/components/app/stop-prompt";
import { TimerHotkey } from "@/components/app/timer-hotkey";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppChrome>
      <div className="flex min-h-[100dvh]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-x-auto p-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+1rem))] sm:p-6 sm:pb-6">
            {children}
          </main>
        </div>
        <StopPrompt />
        <TimerHotkey />
      </div>
    </AppChrome>
  );
}
