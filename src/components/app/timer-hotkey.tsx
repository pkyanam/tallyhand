"use client";

import * as React from "react";
import { useTimerStore } from "@/lib/timer-store";

/**
 * Global ⌘⇧T (or Ctrl+Shift+T) to start/stop the timer. Intentionally fires
 * even when focus is in a text input — a contractor mid-task shouldn't have
 * to reach for the mouse. Also binds the shortcut via `capture` so no form
 * input can swallow it.
 */
export function TimerHotkey() {
  const running = useTimerStore((s) => s.running);
  const projectId = useTimerStore((s) => s.projectId);
  const start = useTimerStore((s) => s.start);
  const stop = useTimerStore((s) => s.stop);

  // Keep the latest values in a ref so the bound handler always sees them
  // without re-binding the listener on every render.
  const latest = React.useRef({ running, projectId, start, stop });
  React.useEffect(() => {
    latest.current = { running, projectId, start, stop };
  }, [running, projectId, start, stop]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key !== "T" && e.key !== "t") return;
      e.preventDefault();
      e.stopPropagation();
      const s = latest.current;
      if (s.running) s.stop();
      else s.start(s.projectId);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, []);

  return null;
}
