"use client";

import * as React from "react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientRepo, mileageRepo } from "@/lib/db/repos";
import { mileageDeduction, mileageRateForYear } from "@/core/mileage";
import { formatCurrency } from "@/lib/utils";
import { useAppChrome } from "@/components/app/app-chrome-provider";

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromDateInput(s: string): number {
  return new Date(`${s}T12:00:00`).getTime();
}

function MileageSectionLocal() {
  const entries = useLiveQuery(() => mileageRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);

  const [showForm, setShowForm] = React.useState(false);
  const [date, setDate] = React.useState(() => toDateInput(Date.now()));
  const [miles, setMiles] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [clientId, setClientId] = React.useState("none");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");

  const yearStart = React.useMemo(
    () => new Date(new Date().getFullYear(), 0, 1).getTime(),
    [],
  );

  const ytd = React.useMemo(() => {
    const list = (entries ?? []).filter((e) => e.date >= yearStart);
    return {
      miles: list.reduce((s, e) => s + e.miles, 0),
      deduction: list.reduce((s, e) => s + mileageDeduction(e), 0),
    };
  }, [entries, yearStart]);

  const clientById = React.useMemo(
    () => new Map((clients ?? []).map((c) => [c.id, c.name])),
    [clients],
  );

  const save = async () => {
    const n = Number.parseFloat(miles);
    if (!Number.isFinite(n) || n <= 0 || !purpose.trim()) return;
    await mileageRepo.create({
      date: fromDateInput(date),
      miles: n,
      purpose: purpose.trim(),
      clientId: clientId === "none" ? undefined : clientId,
      origin: origin.trim() || undefined,
      destination: destination.trim() || undefined,
    });
    setShowForm(false);
    setMiles("");
    setPurpose("");
    setOrigin("");
    setDestination("");
    setClientId("none");
  };

  const sorted = React.useMemo(
    () => [...(entries ?? [])].sort((a, b) => b.date - a.date),
    [entries],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {new Date().getFullYear()}:{" "}
          <span className="font-medium text-foreground">
            {ytd.miles.toFixed(0)} mi
          </span>{" "}
          ·{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(ytd.deduction)}
          </span>{" "}
          deduction at $
          {mileageRateForYear(new Date().getFullYear()).toFixed(2)}/mi
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          Log trip
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Miles</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="12.4"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Business purpose</Label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Client site visit"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>From (optional)</Label>
              <Input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Home"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>To (optional)</Label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Client office"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Client (optional)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(clients ?? [])
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={save}>Save trip</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {sorted.length > 0 ? (
            <ul className="divide-y">
              {sorted.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium tabular-nums">
                        {e.miles.toFixed(1)} mi
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {formatCurrency(mileageDeduction(e))}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.date).toLocaleDateString()} · {e.purpose}
                      {e.origin || e.destination
                        ? ` · ${e.origin || "?"} → ${e.destination || "?"}`
                        : ""}
                      {e.clientId && clientById.get(e.clientId)
                        ? ` · ${clientById.get(e.clientId)}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => {
                      if (window.confirm("Delete this trip?")) {
                        void mileageRepo.remove(e.id);
                      }
                    }}
                    aria-label="Delete trip"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No mileage logged yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function MileageSection() {
  const { dataMode } = useAppChrome();
  if (dataMode === "cloud") {
    return (
      <p className="text-sm text-muted-foreground">
        Mileage tracking isn&apos;t available in cloud mode yet.
      </p>
    );
  }
  return <MileageSectionLocal />;
}
