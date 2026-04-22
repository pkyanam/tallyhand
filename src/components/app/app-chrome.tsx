"use client";

import type { ReactNode } from "react";
import { AppChromeProvider } from "@/components/app/app-chrome-provider";
import { CommandHotkey } from "@/components/app/command-hotkey";
import { CommandPalette } from "@/components/app/command-palette";
import { ReckoningAutoOpen } from "@/components/app/reckoning-auto-open";
import { SettingsThemeSync } from "@/components/app/settings-theme-sync";

export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <AppChromeProvider>
      <SettingsThemeSync />
      <ReckoningAutoOpen />
      {children}
      <CommandPalette />
      <CommandHotkey />
    </AppChromeProvider>
  );
}
