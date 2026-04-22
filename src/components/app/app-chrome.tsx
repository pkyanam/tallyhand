"use client";

import type { ReactNode } from "react";
import { AppChromeProvider } from "@/components/app/app-chrome-provider";
import { CommandHotkey } from "@/components/app/command-hotkey";
import { CommandPalette } from "@/components/app/command-palette";

export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <AppChromeProvider>
      {children}
      <CommandPalette />
      <CommandHotkey />
    </AppChromeProvider>
  );
}
