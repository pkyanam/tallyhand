"use client";

import { Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { TimerWidget } from "./timer-widget";
import { MobileNav } from "@/components/app/mobile-nav";

export function Topbar() {
  const { setCommandOpen } = useAppChrome();

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b bg-background/95 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-4">
      <MobileNav />
      <div className="min-w-0 flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="inline-flex shrink-0 gap-1.5 text-muted-foreground sm:gap-2"
        aria-label="Open command palette"
        onClick={() => setCommandOpen(true)}
      >
        <Command className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 md:inline-flex">
          ⌘K
        </kbd>
      </Button>
      <TimerWidget />
      <ThemeToggle />
    </header>
  );
}
