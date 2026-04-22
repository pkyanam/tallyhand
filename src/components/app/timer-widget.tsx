"use client";

import * as React from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectPicker } from "./project-picker";
import { cn } from "@/lib/utils";
import { useTimerStore } from "@/lib/timer-store";
import { formatElapsed } from "@/lib/datetime";

export function TimerWidget() {
  const running = useTimerStore((s) => s.running);
  const startedAt = useTimerStore((s) => s.startedAt);
  const projectId = useTimerStore((s) => s.projectId);
  const start = useTimerStore((s) => s.start);
  const stop = useTimerStore((s) => s.stop);
  const setProject = useTimerStore((s) => s.setProject);

  const [now, setNow] = React.useState(() => Date.now());
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!running || startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  const elapsed = running && startedAt != null ? now - startedAt : 0;

  const toggle = () => {
    if (running) {
      stop();
    } else {
      start(projectId);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {hydrated && (
        <ProjectPicker
          value={projectId}
          onChange={setProject}
          placeholder="No project"
          triggerClassName="hidden max-w-[220px] md:inline-flex"
          size="sm"
        />
      )}
      <div
        className={cn(
          "min-w-[3.25rem] text-right font-mono text-xs tabular-nums sm:min-w-[4.5rem] sm:text-sm",
          running ? "text-foreground" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {formatElapsed(elapsed)}
      </div>
      <Button
        variant={running ? "destructive" : "default"}
        size="sm"
        onClick={toggle}
        className="gap-1.5"
        aria-label={running ? "Stop timer" : "Start timer"}
        title={running ? "Stop timer (⌘⇧T)" : "Start timer (⌘⇧T)"}
      >
        {running ? (
          <>
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5 fill-current" />
            Start
          </>
        )}
      </Button>
    </div>
  );
}
