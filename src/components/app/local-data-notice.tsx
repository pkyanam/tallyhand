"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "tallyhand.dismissLocalDataNotice";

export function LocalDataNotice() {
  const [dismissed, setDismissed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (dismissed === null || dismissed) return null;

  return (
    <div className="mb-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Your data stays in this browser</p>
        <p className="mt-1 text-muted-foreground">
          Clearing site data or using another device removes access unless you
          export regularly. Use{" "}
          <Link
            href="/settings"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Settings → Data
          </Link>{" "}
          for JSON backup.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={dismiss}
        aria-label="Dismiss notice"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
