"use client";

import { Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { TimerWidget } from "./timer-widget";

export function Topbar() {
  const { setCommandOpen } = useAppChrome();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 text-muted-foreground sm:inline-flex"
        aria-label="Open command palette"
        onClick={() => setCommandOpen(true)}
      >
        <Command className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Search</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 md:inline-flex">
          ⌘K
        </kbd>
      </Button>
      <TimerWidget />
      <ThemeToggle />
    </header>
  );
}
