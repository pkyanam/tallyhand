"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPicker } from "./project-picker";
import { TagsInput } from "./tags-input";
import { projectRepo, taskRepo } from "@/lib/db/repos";
import {
  fromLocalInputValue,
  toLocalInputValue,
} from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";

export interface ManualEntryDialogProps {
  trigger?: React.ReactNode;
  defaultProjectId?: string | null;
  onCreated?: () => void;
}

interface FormState {
  name: string;
  projectId: string | null;
  startAt: number;
  endAt: number;
  notes: string;
  tags: string[];
}

function defaultFormState(projectId: string | null = null): FormState {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  return {
    name: "",
    projectId,
    startAt: oneHourAgo,
    endAt: now,
    notes: "",
    tags: [],
  };
}

export function ManualEntryDialog({
  trigger,
  defaultProjectId = null,
  onCreated,
}: ManualEntryDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(() =>
    defaultFormState(defaultProjectId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const projects = useLiveQuery(() => projectRepo.list(), []);

  React.useEffect(() => {
    if (open) {
      setForm(defaultFormState(defaultProjectId));
      setError(null);
    }
  }, [open, defaultProjectId]);

  const durationMin = Math.max(
    0,
    Math.round((form.endAt - form.startAt) / 60_000),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError("Task name is required.");
      return;
    }
    if (!form.projectId) {
      setError("Pick a project.");
      return;
    }
    if (!projects?.some((p) => p.id === form.projectId)) {
      setError("That project no longer exists.");
      return;
    }
    if (form.endAt <= form.startAt) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      await taskRepo.create({
        projectId: form.projectId,
        name,
        startAt: form.startAt,
        endAt: form.endAt,
        notes: form.notes.trim() || undefined,
        tags: form.tags,
      });
      setOpen(false);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Plus className="mr-1 h-4 w-4" />
            Add entry
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add time entry</DialogTitle>
          <DialogDescription>
            Log time after the fact — useful when you forgot to start the
            timer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="manual-name">
              Task name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="manual-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Drafted the quarterly report"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Project <span className="text-destructive">*</span>
            </Label>
            <ProjectPicker
              value={form.projectId}
              onChange={(id) => setForm({ ...form, projectId: id })}
              triggerClassName="w-full"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-start">Start</Label>
              <Input
                id="manual-start"
                type="datetime-local"
                value={toLocalInputValue(form.startAt)}
                onChange={(e) => {
                  const ms = fromLocalInputValue(e.target.value);
                  if (ms != null) setForm({ ...form, startAt: ms });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-end">End</Label>
              <Input
                id="manual-end"
                type="datetime-local"
                value={toLocalInputValue(form.endAt)}
                onChange={(e) => {
                  const ms = fromLocalInputValue(e.target.value);
                  if (ms != null) setForm({ ...form, endAt: ms });
                }}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Duration:{" "}
            <span className="font-medium">{formatDuration(durationMin)}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-notes">Notes</Label>
            <Textarea
              id="manual-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-tags">Tags</Label>
            <TagsInput
              id="manual-tags"
              value={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
