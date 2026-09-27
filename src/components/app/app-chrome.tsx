"use client";

import type { ReactNode } from "react";
import { AppChromeProvider } from "@/components/app/app-chrome-provider";
import { CommandHotkey } from "@/components/app/command-hotkey";
import { CommandPalette } from "@/components/app/command-palette";
import { ReckoningAutoOpen } from "@/components/app/reckoning-auto-open";
import { RecurringSchedulerCheck } from "@/components/app/recurring-scheduler-check";
import { SettingsThemeSync } from "@/components/app/settings-theme-sync";
import type { AppDataMode } from "@/components/app/data-mode-copy";

export function AppChrome({
  children,
  dataMode,
}: {
  children: ReactNode;
  dataMode: AppDataMode;
}) {
  return (
    <AppChromeProvider dataMode={dataMode}>
      <SettingsThemeSync />
      <ReckoningAutoOpen />
      <RecurringSchedulerCheck />
      {children}
      <CommandPalette />
      <CommandHotkey />
    </AppChromeProvider>
  );
}
