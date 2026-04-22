import type { ReactNode } from "react";
import { AppChrome } from "@/components/app/app-chrome";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { StopPrompt } from "@/components/app/stop-prompt";
import { TimerHotkey } from "@/components/app/timer-hotkey";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppChrome>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-6">{children}</main>
        </div>
        <StopPrompt />
        <TimerHotkey />
      </div>
    </AppChrome>
  );
}
