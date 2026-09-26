"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rateCardRepo } from "@/lib/db/repos";
import { activeRateCards } from "@/core/rate-cards";
import { formatCurrency } from "@/lib/utils";
import type { Project, RateCard } from "@/lib/db/types";

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromDateInput(s: string): number {
  return new Date(`${s}T12:00:00`).getTime();
}

function RateCardForm({
  clientId,
  projects,
  existing,
  onDone,
}: {
  clientId: string;
  projects: Project[];
  existing?: RateCard;
  onDone: () => void;
}) {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [defaultRate, setDefaultRate] = React.useState(
    existing ? String(existing.defaultRate) : "",
  );
  const [effectiveFrom, setEffectiveFrom] = React.useState(
    toDateInput(existing?.effectiveFrom ?? Date.now()),
  );
  const [effectiveTo, setEffectiveTo] = React.useState(
    existing?.effectiveTo ? toDateInput(existing.effectiveTo) : "",
  );
  const [projectId, setProjectId] = React.useState(existing?.projectId ?? "none");
  const [linesText, setLinesText] = React.useState(
    (existing?.lines ?? [])
      .map((l) => `${l.label}: ${l.rate}`)
      .join("\n"),
  );

  const save = async () => {
    const rate = Number.parseFloat(defaultRate);
    if (!name.trim() || !Number.isFinite(rate) || rate < 0) return;
    const lines = linesText
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row, i) => {
        const [label, ratePart] = row.split(":").map((s) => s.trim());
        const lineRate = Number.parseFloat(ratePart ?? "");
        return {
          id: existing?.lines[i]?.id ?? `line-${Date.now()}-${i}`,
          label: label || row,
          rate: Number.isFinite(lineRate) && lineRate >= 0 ? lineRate : rate,
        };
      });
    const input = {
      clientId,
      name: name.trim(),
      defaultRate: rate,
      effectiveFrom: fromDateInput(effectiveFrom),
      effectiveTo: effectiveTo.trim()
        ? fromDateInput(effectiveTo)
        : undefined,
      projectId: projectId === "none" ? undefined : projectId,
      lines,
    };
    if (existing) {
      await rateCardRepo.update(existing.id, input);
    } else {
      await rateCardRepo.create(input);
    }
    onDone();
  };

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2026 standard rates"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Default rate ($/hr)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={defaultRate}
            onChange={(e) => setDefaultRate(e.target.value)}
            placeholder="150"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Effective from</Label>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Effective to (optional)</Label>
          <Input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Project (optional)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Rate lines — one per line, “Label: rate”</Label>
          <Textarea
            rows={3}
            value={linesText}
            onChange={(e) => setLinesText(e.target.value)}
            placeholder={"Backend dev: 175\nDesign: 150"}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button onClick={save}>{existing ? "Save" : "Add rate card"}</Button>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RateCardsSection({
  clientId,
  projects,
}: {
  clientId: string;
  projects: Project[];
}) {
  const cards = useLiveQuery(
    () => rateCardRepo.listByClient(clientId),
    [clientId],
  );
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<RateCard | null>(null);

  const now = Date.now();
  const activeIds = React.useMemo(
    () => new Set(activeRateCards(cards ?? [], clientId, now).map((c) => c.id)),
    [cards, clientId, now],
  );
  const sorted = React.useMemo(
    () =>
      [...(cards ?? [])].sort((a, b) => b.effectiveFrom - a.effectiveFrom),
    [cards],
  );
  const projectById = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Rate cards</h2>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          New rate card
        </Button>
      </div>

      {showForm && (
        <RateCardForm
          clientId={clientId}
          projects={projects}
          onDone={() => setShowForm(false)}
        />
      )}
      {editing && (
        <RateCardForm
          clientId={clientId}
          projects={projects}
          existing={editing}
          onDone={() => setEditing(null)}
        />
      )}

      {sorted.length === 0 && !showForm ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No rate cards yet. Add one to track negotiated rates over time.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {sorted.map((card) => (
                <li key={card.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{card.name}</span>
                    {activeIds.has(card.id) ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">
                        {card.effectiveFrom > now ? "Upcoming" : "Expired"}
                      </Badge>
                    )}
                    {card.archived && <Badge variant="outline">Archived</Badge>}
                    <span className="ml-auto font-medium tabular-nums">
                      {formatCurrency(card.defaultRate)}/hr
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Effective {toDateInput(card.effectiveFrom)}
                    {card.effectiveTo
                      ? ` → ${toDateInput(card.effectiveTo)}`
                      : " → open"}
                    {card.projectId && projectById.get(card.projectId)
                      ? ` · ${projectById.get(card.projectId)}`
                      : ""}
                    {card.lines.length > 0 &&
                      ` · ${card.lines.map((l) => `${l.label} ${formatCurrency(l.rate)}`).join(", ")}`}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEditing(card)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        void rateCardRepo.update(card.id, {
                          archived: !card.archived,
                        })
                      }
                    >
                      {card.archived ? "Unarchive" : "Archive"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => {
                        if (window.confirm("Delete this rate card?")) {
                          void rateCardRepo.remove(card.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
