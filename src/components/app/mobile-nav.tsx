"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "@/components/app/app-nav-items";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex md:hidden">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-app-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="mobile-app-nav"
          className={cn(
            "fixed inset-y-0 left-0 top-0 z-50 flex h-[100dvh] max-h-[100dvh] w-[min(100%,18rem)] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border border-b-0 border-l-0 border-t-0 p-0 shadow-lg",
          )}
        >
          <DialogTitle className="sr-only">App sections</DialogTitle>
          <div className="flex items-center gap-2 border-b px-4 py-3 pr-14 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
            <div className="h-6 w-6 shrink-0 rounded bg-foreground" aria-hidden />
            <span className="font-semibold tracking-tight">Tallyhand</span>
          </div>
          <nav className="flex-1 space-y-1 p-2" aria-label="Main">
            {APP_NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] text-xs text-muted-foreground">
            <div>Local-first · Offline-ready</div>
            <Link
              href="/shortcuts"
              className="mt-2 block text-foreground/80 underline-offset-4 hover:underline"
              onClick={() => setOpen(false)}
            >
              Keyboard shortcuts
            </Link>
            <div className="mt-1 opacity-70">v0.1.0</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
