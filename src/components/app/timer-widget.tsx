"use client";

import * as React from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TimerWidget() {
  const [running, setRunning] = React.useState(false);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!running || startedAt == null) return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 500);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  const toggle = () => {
    if (!running) {
      setStartedAt(Date.now());
      setElapsed(0);
      setRunning(true);
    } else {
      setRunning(false);
    }
  };

  const display = formatElapsed(elapsed);

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "hidden min-w-[80px] text-right font-mono text-sm tabular-nums sm:block",
          running ? "text-foreground" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {display}
      </div>
      <Button
        variant={running ? "destructive" : "default"}
        size="sm"
        onClick={toggle}
        className="gap-1.5"
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

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
