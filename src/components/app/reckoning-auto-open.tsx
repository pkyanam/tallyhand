"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { settingsRepo } from "@/lib/db/repos";
import { isReckoningDue } from "@/lib/reckoning-schedule";

const SESSION_KEY = "tallyhand.reckoning.autoOpened";

let lastReckoningAutoOpenAttemptMs = 0;

export function ReckoningAutoOpen() {
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (pathname?.startsWith("/reckoning")) return;

    const t = Date.now();
    if (t - lastReckoningAutoOpenAttemptMs < 400) return;
    lastReckoningAutoOpenAttemptMs = t;

    let cancelled = false;

    void (async () => {
      try {
        const s = await settingsRepo.get();
        if (cancelled) return;
        if (!s.reckoning.enabled) return;
        if (
          !isReckoningDue(
            Date.now(),
            s.reckoning.dayOfWeek,
            s.reckoning.hourOfDay,
            s.reckoning.lastCompletedAtMs,
          )
        ) {
          return;
        }
        if (sessionStorage.getItem(SESSION_KEY)) return;
        sessionStorage.setItem(SESSION_KEY, "1");
        router.push("/reckoning");
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  return null;
}
