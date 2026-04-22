"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { persistThemeChoice } from "@/components/app/settings-theme-sync";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const cycle = () => {
    const next =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    void persistThemeChoice(next);
  };

  const Icon = !mounted
    ? Sun
    : theme === "dark"
      ? Moon
      : theme === "system"
        ? Monitor
        : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label="Toggle theme"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
