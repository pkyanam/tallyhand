"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { TimerWidget } from "./timer-widget";
import { MobileNav } from "@/components/app/mobile-nav";

export function Topbar() {
  const { setCommandOpen } = useAppChrome();

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b bg-background/95 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-6 lg:px-8">
      <MobileNav />
      <Button
        variant="outline"
        size="sm"
        className="inline-flex shrink-0 justify-start gap-2 text-muted-foreground sm:h-9 sm:w-44 lg:w-[min(32vw,440px)]"
        aria-label="Open command palette"
        onClick={() => setCommandOpen(true)}
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        <span className="hidden flex-1 text-left sm:inline">Search anything…</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 md:inline-flex">
          ⌘K
        </kbd>
      </Button>
      <div className="min-w-0 flex-1" />
      <TimerWidget />
      <ThemeToggle />
    </header>
  );
}
