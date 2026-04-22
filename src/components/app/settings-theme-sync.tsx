"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { settingsRepo } from "@/lib/db/repos";
import type { Settings } from "@/lib/db/types";

export function SettingsThemeSync() {
  const { setTheme } = useTheme();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await settingsRepo.get();
      if (cancelled) return;
      const t = s.appearance.theme;
      if (t === "light" || t === "dark" || t === "system") setTheme(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  return null;
}

export async function persistThemeChoice(
  theme: Settings["appearance"]["theme"],
) {
  await settingsRepo.update({ appearance: { theme } });
}
