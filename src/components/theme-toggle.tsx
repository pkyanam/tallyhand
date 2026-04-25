"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { persistThemeChoice } from "@/components/app/settings-theme-sync";

function getThemeMode(theme?: string, resolvedTheme?: string) {
  if (theme === "dark" || resolvedTheme === "dark") return "dark";
  return "light";
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const mode = mounted ? getThemeMode(theme, resolvedTheme) : "light";
  const nextTheme = mode === "dark" ? "light" : "dark";

  const cycle = () => {
    setTheme(nextTheme);
    void persistThemeChoice(nextTheme);
  };

  const Icon = mode === "dark" ? Sun : Moon;
  const label = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0 gap-2"
      onClick={cycle}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">
        {mode === "dark" ? "Light mode" : "Dark mode"}
      </span>
    </Button>
  );
}
