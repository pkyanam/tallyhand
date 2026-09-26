"use client";

import * as React from "react";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { runDueRecurringSchedules } from "@/lib/recurring-scheduler";

const LAST_RUN_KEY = "tallyhand.recurring.lastRun";
const LOCK_KEY = "tallyhand.recurring.lock";
/** At most one automatic run per hour, across tabs and sessions. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
/** A lock older than this is considered stale (crashed tab). */
const LOCK_TTL_MS = 5 * 60 * 1000;
/** Re-check cadence while the app stays open. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Fires due recurring-invoice schedules in the background: on mount and
 * every 15 minutes. Guards against double-runs across tabs via a
 * localStorage lock, and never surfaces errors to the user — the scheduler
 * must not break the app.
 */
export function RecurringSchedulerCheck() {
  const { showNotice } = useAppChrome();

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      try {
        const now = Date.now();
        const lastRun = Number(localStorage.getItem(LAST_RUN_KEY) ?? 0);
        if (now - lastRun < MIN_INTERVAL_MS) return;
        const lock = Number(localStorage.getItem(LOCK_KEY) ?? 0);
        if (now - lock < LOCK_TTL_MS) return;
        localStorage.setItem(LOCK_KEY, String(now));
        try {
          const { generated } = await runDueRecurringSchedules(now);
          if (cancelled) return;
          localStorage.setItem(LAST_RUN_KEY, String(now));
          if (generated.length > 0) {
            showNotice(
              `Drafted ${generated.length} recurring invoice${generated.length === 1 ? "" : "s"} — review and send when ready.`,
            );
          }
        } finally {
          localStorage.removeItem(LOCK_KEY);
        }
      } catch {
        /* the scheduler must never break the app */
      }
    };

    void run();
    timer = setInterval(() => {
      void run();
    }, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [showNotice]);

  return null;
}
