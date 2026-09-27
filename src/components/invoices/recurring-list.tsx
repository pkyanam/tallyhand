"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { clientRepo, recurringScheduleRepo } from "@/lib/db/repos";
import { runDueRecurringSchedules } from "@/lib/recurring-scheduler";
import { describeFrequency } from "@/core/recurring";
import type { RecurringStatus } from "@/core/recurring";

function statusBadge(status: RecurringStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "active":
      return {
        label: "Active",
        className: "badge-positive",
      };
    case "paused":
      return {
        label: "Paused",
        className: "badge-neutral",
      };
    default:
      return {
        label: "Ended",
        className: "badge-quiet",
      };
  }
}

export function RecurringList() {
  const schedules = useLiveQuery(() => recurringScheduleRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const { showNotice } = useAppChrome();
  const [runningId, setRunningId] = React.useState<string | null>(null);

  const clientById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients ?? []) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const handleRunNow = async (id: string, name: string) => {
    setRunningId(id);
    try {
      const { generated, skipped } = await runDueRecurringSchedules(
        Date.now(),
        id,
      );
      if (generated.length > 0) {
        showNotice(`Drafted invoice from "${name}" — review and send when ready.`);
      } else if (skipped.length > 0) {
        showNotice(`Couldn't run "${name}": ${skipped[0].reason}.`);
      }
    } finally {
      setRunningId(null);
    }
  };

  const handleTogglePause = async (
    id: string,
    status: RecurringStatus,
    name: string,
  ) => {
    await recurringScheduleRepo.update(id, {
      status: status === "paused" ? "active" : "paused",
    });
    showNotice(
      status === "paused" ? `Resumed "${name}".` : `Paused "${name}".`,
    );
  };

  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm(
      `Delete the recurring schedule "${name}"? This cannot be undone.`,
    );
    if (!ok) return;
    setDeleteError(null);
    try {
      await recurringScheduleRepo.remove(id);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete this schedule.",
      );
    }
  };

  return (
    <>
      {deleteError && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {deleteError}
        </div>
      )}
      <PageHeader
        title="Recurring invoices"
        description="Automated billing schedules. Drafts are generated for your review — nothing is ever sent automatically."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/invoices">All invoices</Link>
            </Button>
            <Button asChild>
              <Link href="/invoices/recurring/new">
                <Plus className="mr-1 h-4 w-4" />
                New schedule
              </Link>
            </Button>
          </>
        }
      />

      {schedules === undefined ? (
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading schedules…
          </CardContent>
        </Card>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <CalendarClock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No recurring schedules yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bill a monthly retainer or sweep up unbilled work on a schedule.
              </p>
            </div>
            <Button asChild>
              <Link href="/invoices/recurring/new">
                <Plus className="mr-1 h-4 w-4" />
                New schedule
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {schedules.map((s) => {
                const badge = statusBadge(s.status);
                const occurrences = s.maxOccurrences
                  ? `${s.occurrences}/${s.maxOccurrences}`
                  : `${s.occurrences} run${s.occurrences === 1 ? "" : "s"}`;
                return (
                  <li
                    key={s.id}
                    className="group flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/invoices/recurring/${s.id}/edit`}
                          className="truncate font-medium hover:underline"
                        >
                          {s.name}
                        </Link>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                        <Badge variant="outline">
                          {s.mode === "fixed" ? "Fixed" : "Unbilled"}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {clientById.get(s.clientId) ?? "Unknown client"}
                        {" · "}
                        {describeFrequency(s.frequency, s.interval)}
                        {" · next "}
                        {s.status === "ended"
                          ? "—"
                          : new Date(s.nextRunAt).toLocaleDateString()}
                        {" · "}
                        {occurrences}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {s.status !== "ended" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={runningId === s.id}
                          onClick={() => handleRunNow(s.id, s.name)}
                          aria-label={`Run "${s.name}" now`}
                          title="Run now"
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                      )}
                      {s.status !== "ended" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            handleTogglePause(s.id, s.status, s.name)
                          }
                          aria-label={
                            s.status === "paused"
                              ? `Resume "${s.name}"`
                              : `Pause "${s.name}"`
                          }
                          title={s.status === "paused" ? "Resume" : "Pause"}
                        >
                          {s.status === "paused" ? (
                            <Play className="h-4 w-4" />
                          ) : (
                            <Pause className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        asChild
                        aria-label={`Edit "${s.name}"`}
                        title="Edit"
                      >
                        <Link href={`/invoices/recurring/${s.id}/edit`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(s.id, s.name)}
                        aria-label={`Delete "${s.name}"`}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
