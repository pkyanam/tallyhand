"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { ManualEntryDialog } from "@/components/app/manual-entry-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ProjectPicker } from "@/components/app/project-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startOfWeekMonday, tasksInWeekRange } from "@/lib/aggregations";
import { clientRepo, projectRepo, taskRepo } from "@/lib/db/repos";
import type { Client, Project, Task } from "@/lib/db/types";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/datetime";
import { DAY_MS, summarizeWeekTasks, tasksForDay, weekDays } from "@/lib/timesheet";
import { formatCurrency, formatDuration } from "@/lib/utils";

type TaskDraft = {
  name: string;
  projectId: string | null;
  startAt: number;
  endAt: number;
  notes: string;
  isBilled: boolean;
};

function draftFromTask(task: Task): TaskDraft {
  return {
    name: task.name,
    projectId: task.projectId,
    startAt: task.startAt,
    endAt: task.endAt,
    notes: task.notes ?? "",
    isBilled: task.isBilled,
  };
}

function sameDraft(a: TaskDraft, b: TaskDraft): boolean {
  return (
    a.name === b.name &&
    a.projectId === b.projectId &&
    a.startAt === b.startAt &&
    a.endAt === b.endAt &&
    a.notes === b.notes &&
    a.isBilled === b.isBilled
  );
}

function formatWeekRangeLabel(weekStartMs: number): string {
  const start = new Date(weekStartMs);
  const end = new Date(weekStartMs + 6 * DAY_MS);
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
}

function formatDayLabel(dayStartMs: number): string {
  return new Date(dayStartMs).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatDayShortLabel(dayStartMs: number): string {
  return new Date(dayStartMs).toLocaleDateString(undefined, {
    weekday: "short",
  });
}

export function TimesheetContent() {
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);

  const [weekStartMs, setWeekStartMs] = React.useState(() =>
    startOfWeekMonday(new Date()),
  );
  const [isNavigating, startNavigation] = React.useTransition();

  const activeProjects = React.useMemo(
    () => (projects ?? []).filter((project) => !project.archived),
    [projects],
  );

  const weekTasks = React.useMemo(
    () => tasksInWeekRange(tasks ?? [], weekStartMs),
    [tasks, weekStartMs],
  );

  const projectById = React.useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projects ?? []) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const clientById = React.useMemo(() => {
    const map = new Map<string, Client>();
    for (const client of clients ?? []) {
      map.set(client.id, client);
    }
    return map;
  }, [clients]);

  const summary = React.useMemo(
    () => summarizeWeekTasks(weekTasks, projects ?? [], clients ?? []),
    [clients, projects, weekTasks],
  );

  const days = React.useMemo(
    () =>
      weekDays(weekStartMs).map((dayStartMs) => ({
        dayStartMs,
        tasks: tasksForDay(weekTasks, dayStartMs),
      })),
    [weekStartMs, weekTasks],
  );

  const jumpWeek = (offset: number) => {
    startNavigation(() => {
      setWeekStartMs((current) => current + offset * 7 * DAY_MS);
    });
  };

  const goToCurrentWeek = () => {
    startNavigation(() => {
      setWeekStartMs(startOfWeekMonday(new Date()));
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly timesheet"
        description="Review, edit, and clean up every entry for the week from one page."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => jumpWeek(-1)}
              disabled={isNavigating}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToCurrentWeek}
              disabled={isNavigating}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jumpWeek(1)}
              disabled={isNavigating}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
            <ManualEntryDialog
              defaultDayStartMs={weekStartMs}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Add entry
                </Button>
              }
            />
          </div>
        }
      />

      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Week of
            </div>
            <div className="text-2xl font-semibold tracking-tight">
              {formatWeekRangeLabel(weekStartMs)}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Save changes inline, or add missing entries directly to a specific
              day.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"}
            </Badge>
            <Badge variant="outline">{formatDuration(summary.totalMinutes)}</Badge>
          </div>
        </CardContent>
      </Card>

      {tasks === undefined || projects === undefined || clients === undefined ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading this week&apos;s entries…
          </CardContent>
        </Card>
      ) : activeProjects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Create a client and project first so the weekly timesheet has
              somewhere to file your hours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/clients/new">Create your first client</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Tracked time" value={formatDuration(summary.totalMinutes)} />
            <StatCard label="Unbilled time" value={formatDuration(summary.unbilledMinutes)} />
            <StatCard label="Estimated value" value={formatCurrency(summary.unbilledAmount)} />
            <StatCard label="Billed time" value={formatDuration(summary.billedMinutes)} />
          </div>

          <div className="space-y-4">
            {days.map((day) => {
              const dayMinutes = day.tasks.reduce(
                (total, task) => total + task.durationMinutes,
                0,
              );

              return (
                <Card key={day.dayStartMs}>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{formatDayLabel(day.dayStartMs)}</CardTitle>
                      <CardDescription>
                        {formatDayShortLabel(day.dayStartMs)} totals{" "}
                        {formatDuration(dayMinutes)}
                      </CardDescription>
                    </div>
                    <ManualEntryDialog
                      defaultDayStartMs={day.dayStartMs}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4" />
                          Add to day
                        </Button>
                      }
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {day.tasks.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        No entries yet for this day.
                      </div>
                    ) : (
                      day.tasks.map((task) => (
                        <TimesheetEntryEditor
                          key={task.id}
                          task={task}
                          projectById={projectById}
                          clientById={clientById}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TimesheetEntryEditor({
  task,
  projectById,
  clientById,
}: {
  task: Task;
  projectById: Map<string, Project>;
  clientById: Map<string, Client>;
}) {
  const [draft, setDraft] = React.useState<TaskDraft>(() => draftFromTask(task));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const { id, endAt, isBilled, name, notes, projectId, startAt, updatedAt } =
    task;

  const syncedDraft = React.useMemo(
    () => ({
      name,
      projectId,
      startAt,
      endAt,
      notes: notes ?? "",
      isBilled,
    }),
    [endAt, isBilled, name, notes, projectId, startAt],
  );

  React.useEffect(() => {
    setDraft(syncedDraft);
    setError(null);
  }, [syncedDraft, updatedAt]);

  const baseline = syncedDraft;
  const isDirty = !sameDraft(draft, baseline);
  const durationMinutes = Math.max(
    0,
    Math.round((draft.endAt - draft.startAt) / 60_000),
  );

  const project = draft.projectId ? projectById.get(draft.projectId) : undefined;
  const client = project ? clientById.get(project.clientId) : undefined;

  const handleSave = async () => {
    setError(null);

    const name = draft.name.trim();
    if (!name) {
      setError("Task name is required.");
      return;
    }
    if (!draft.projectId) {
      setError("Pick a project.");
      return;
    }
    if (!projectById.has(draft.projectId)) {
      setError("That project no longer exists.");
      return;
    }
    if (draft.endAt <= draft.startAt) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      await taskRepo.update(id, {
        name,
        projectId: draft.projectId,
        startAt: draft.startAt,
        endAt: draft.endAt,
        notes: draft.notes.trim() || undefined,
        isBilled: draft.isBilled,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this time entry?")) return;

    setDeleting(true);
    setError(null);
    try {
      await taskRepo.remove(id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this entry.",
      );
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-background/60 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1.5">
              <Label htmlFor={`task-name-${task.id}`}>Task</Label>
              <Input
                id={`task-name-${task.id}`}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="What did you work on?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Project</Label>
              <ProjectPicker
                value={draft.projectId}
                onChange={(projectId) =>
                  setDraft((current) => ({ ...current, projectId }))
                }
                size="default"
                triggerClassName="w-full"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`task-start-${task.id}`}>Start</Label>
              <Input
                id={`task-start-${task.id}`}
                type="datetime-local"
                value={toLocalInputValue(draft.startAt)}
                onChange={(event) => {
                  const value = fromLocalInputValue(event.target.value);
                  if (value == null) return;
                  setDraft((current) => ({ ...current, startAt: value }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`task-end-${task.id}`}>End</Label>
              <Input
                id={`task-end-${task.id}`}
                type="datetime-local"
                value={toLocalInputValue(draft.endAt)}
                onChange={(event) => {
                  const value = fromLocalInputValue(event.target.value);
                  if (value == null) return;
                  setDraft((current) => ({ ...current, endAt: value }));
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`task-notes-${task.id}`}>Notes</Label>
            <Textarea
              id={`task-notes-${task.id}`}
              rows={2}
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Optional notes for this entry"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-dashed p-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Entry details</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{formatDuration(durationMinutes)}</Badge>
              {draft.isBilled ? <Badge variant="outline">Billed</Badge> : null}
              {client ? <Badge variant="outline">{client.name}</Badge> : null}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.isBilled}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  isBilled: checked === true,
                }))
              }
            />
            Mark as billed
          </label>

          {project ? (
            <p className="text-sm text-muted-foreground">
              {client ? `${client.name} · ` : ""}
              {project.name}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a project to keep this entry assigned correctly.
            </p>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDraft(baseline);
                setError(null);
              }}
              disabled={!isDirty || saving || deleting}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={handleSave} disabled={!isDirty || saving || deleting}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
