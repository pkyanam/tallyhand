"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPicker } from "./project-picker";
import { TagsInput } from "./tags-input";
import { projectRepo, taskRepo } from "@/lib/db/repos";
import { useTimerStore } from "@/lib/timer-store";
import {
  fromLocalInputValue,
  toLocalInputValue,
} from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";

export function StopPrompt() {
  const pending = useTimerStore((s) => s.pending);
  const promptOpen = useTimerStore((s) => s.promptOpen);
  const openPrompt = useTimerStore((s) => s.openPrompt);
  const closePrompt = useTimerStore((s) => s.closePrompt);
  const clearPending = useTimerStore((s) => s.clearPending);
  const setProject = useTimerStore((s) => s.setProject);

  // Re-open the prompt on mount if a pending entry was persisted from a
  // previous session and the user never finished saving it.
  React.useEffect(() => {
    if (pending && !promptOpen) openPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pending) return null;

  return (
    <Dialog
      open={promptOpen}
      onOpenChange={(open) => {
        if (open) openPrompt();
        else closePrompt();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What did you just do?</DialogTitle>
          <DialogDescription>
            Save this time entry. Close this dialog to keep it as a draft.
          </DialogDescription>
        </DialogHeader>

        <StopPromptForm
          onSaved={() => {
            clearPending();
          }}
          onDiscard={() => {
            clearPending();
          }}
          onProjectChange={(id) => setProject(id)}
        />
      </DialogContent>
    </Dialog>
  );
}

function StopPromptForm({
  onSaved,
  onDiscard,
  onProjectChange,
}: {
  onSaved: () => void;
  onDiscard: () => void;
  onProjectChange: (id: string | null) => void;
}) {
  const pending = useTimerStore((s) => s.pending);
  const updatePending = useTimerStore((s) => s.updatePending);

  const projects = useLiveQuery(() => projectRepo.list(), []);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (!pending) return null;

  const durationMin = Math.max(
    0,
    Math.round((pending.endAt - pending.startAt) / 60_000),
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = pending.name.trim();
    if (!name) {
      setError("Task name is required.");
      return;
    }
    if (!pending.projectId) {
      setError("Pick a project.");
      return;
    }
    if (!projects?.some((p) => p.id === pending.projectId)) {
      setError("That project no longer exists.");
      return;
    }
    if (pending.endAt <= pending.startAt) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      await taskRepo.create({
        projectId: pending.projectId,
        name,
        startAt: pending.startAt,
        endAt: pending.endAt,
        notes: pending.notes.trim() || undefined,
        tags: pending.tags,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    const ok = window.confirm(
      "Discard this time entry? The tracked duration will be lost.",
    );
    if (ok) onDiscard();
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="task-name">
          Task name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="task-name"
          autoFocus
          value={pending.name}
          onChange={(e) => updatePending({ name: e.target.value })}
          placeholder="Designed the landing page hero"
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Project <span className="text-destructive">*</span>
        </Label>
        <ProjectPicker
          value={pending.projectId}
          onChange={(id) => {
            updatePending({ projectId: id });
            onProjectChange(id);
          }}
          triggerClassName="w-full"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="start-at">Start</Label>
          <Input
            id="start-at"
            type="datetime-local"
            value={toLocalInputValue(pending.startAt)}
            onChange={(e) => {
              const ms = fromLocalInputValue(e.target.value);
              if (ms != null) updatePending({ startAt: ms });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end-at">End</Label>
          <Input
            id="end-at"
            type="datetime-local"
            value={toLocalInputValue(pending.endAt)}
            onChange={(e) => {
              const ms = fromLocalInputValue(e.target.value);
              if (ms != null) updatePending({ endAt: ms });
            }}
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Duration: <span className="font-medium">{formatDuration(durationMin)}</span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          rows={2}
          value={pending.notes}
          onChange={(e) => updatePending({ notes: e.target.value })}
          placeholder="Anything worth remembering"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags</Label>
        <TagsInput
          id="tags"
          value={pending.tags}
          onChange={(tags) => updatePending({ tags })}
        />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleDiscard}
          disabled={saving}
        >
          Discard
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save entry"}
        </Button>
      </DialogFooter>
    </form>
  );
}
