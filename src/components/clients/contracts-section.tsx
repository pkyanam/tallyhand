"use client";

import * as React from "react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { contractRepo } from "@/lib/db/repos";
import {
  contractStatus,
  needsRenewalAttention,
  type Contract,
  type ContractType,
} from "@/core/contracts";
import type { Project } from "@/lib/db/types";
import { useAppChrome } from "@/components/app/app-chrome-provider";

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromDateInput(s: string): number {
  return new Date(`${s}T12:00:00`).getTime();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

const TYPE_LABELS: Record<ContractType, string> = {
  sow: "SOW",
  msa: "MSA",
  nda: "NDA",
  other: "Other",
};

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  active: "secondary",
  upcoming: "outline",
  expiring: "destructive",
  expired: "outline",
};

function ContractForm({
  clientId,
  projects,
  existing,
  onDone,
}: {
  clientId: string;
  projects: Project[];
  existing?: Contract;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [type, setType] = React.useState<ContractType>(
    existing?.type ?? "sow",
  );
  const [startDate, setStartDate] = React.useState(
    toDateInput(existing?.startDate ?? Date.now()),
  );
  const [endDate, setEndDate] = React.useState(
    existing?.endDate ? toDateInput(existing.endDate) : "",
  );
  const [renewalNoticeDays, setRenewalNoticeDays] = React.useState(
    String(existing?.renewalNoticeDays ?? 30),
  );
  const [autoRenew, setAutoRenew] = React.useState(existing?.autoRenew ?? false);
  const [projectId, setProjectId] = React.useState(existing?.projectId ?? "none");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [fileB64, setFileB64] = React.useState<string | undefined>(
    existing?.fileB64,
  );
  const [fileName, setFileName] = React.useState<string | undefined>(
    existing?.fileName,
  );

  const save = async () => {
    if (!title.trim()) return;
    const input = {
      clientId,
      type,
      title: title.trim(),
      startDate: fromDateInput(startDate),
      endDate: endDate.trim() ? fromDateInput(endDate) : undefined,
      renewalNoticeDays:
        Number.parseInt(renewalNoticeDays, 10) >= 0
          ? Number.parseInt(renewalNoticeDays, 10)
          : 30,
      autoRenew,
      projectId: projectId === "none" ? undefined : projectId,
      notes: notes.trim() || undefined,
      fileB64,
      fileName,
    };
    if (existing) {
      await contractRepo.update(existing.id, input);
    } else {
      await contractRepo.create(input);
    }
    onDone();
  };

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Master services agreement"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as ContractType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as ContractType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Start date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>End date (blank = open-ended)</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Renewal notice (days before end)</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={renewalNoticeDays}
            onChange={(e) => setRenewalNoticeDays(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Project (optional)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`auto-renew-${existing?.id ?? "new"}`}
            checked={autoRenew}
            onCheckedChange={(c) => setAutoRenew(c === true)}
          />
          <Label
            htmlFor={`auto-renew-${existing?.id ?? "new"}`}
            className="font-normal"
          >
            Auto-renews
          </Label>
        </div>
        <div className="grid gap-1.5">
          <Label>Document (optional)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              className="max-w-xs cursor-pointer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void readFileAsDataUrl(f).then((url) => {
                  setFileB64(url);
                  setFileName(f.name);
                });
              }}
            />
            {fileB64 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFileB64(undefined);
                  setFileName(undefined);
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
          {fileName && (
            <p className="text-xs text-muted-foreground">{fileName}</p>
          )}
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Renewal terms, rate lock, …"
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button onClick={save}>{existing ? "Save" : "Add contract"}</Button>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContractsSectionLocal({
  clientId,
  projects,
}: {
  clientId: string;
  projects: Project[];
}) {
  const contracts = useLiveQuery(
    () => contractRepo.listByClient(clientId),
    [clientId],
  );
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<Contract | null>(null);

  const now = Date.now();
  const sorted = React.useMemo(
    () =>
      [...(contracts ?? [])].sort((a, b) => {
        const aAttention = needsRenewalAttention(a, now) ? 0 : 1;
        const bAttention = needsRenewalAttention(b, now) ? 0 : 1;
        if (aAttention !== bAttention) return aAttention - bAttention;
        return b.startDate - a.startDate;
      }),
    [contracts, now],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Contracts
        </h2>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          New contract
        </Button>
      </div>

      {showForm && (
        <ContractForm
          clientId={clientId}
          projects={projects}
          onDone={() => setShowForm(false)}
        />
      )}
      {editing && (
        <ContractForm
          clientId={clientId}
          projects={projects}
          existing={editing}
          onDone={() => setEditing(null)}
        />
      )}

      {sorted.length === 0 && !showForm ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No contracts on file. Store MSAs, SOWs, and NDAs here — with
            renewal reminders before they expire.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {sorted.map((contract) => {
                const info = contractStatus(contract, now);
                const attention = needsRenewalAttention(contract, now);
                return (
                  <li key={contract.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{contract.title}</span>
                      <Badge variant={STATUS_VARIANT[info.status]}>
                        {info.status}
                      </Badge>
                      <Badge variant="outline">{TYPE_LABELS[contract.type]}</Badge>
                      {contract.archived && (
                        <Badge variant="outline">Archived</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {toDateInput(contract.startDate)}
                      {contract.endDate
                        ? ` → ${toDateInput(contract.endDate)}`
                        : " → open-ended"}
                      {attention && info.daysUntilExpiry != null && (
                        <span className="font-medium text-destructive">
                          {" "}· renews in {info.daysUntilExpiry} days
                        </span>
                      )}
                      {contract.autoRenew ? " · auto-renews" : ""}
                    </p>
                    {contract.notes && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {contract.notes}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {contract.fileB64 && (
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={contract.fileB64}
                            download={contract.fileName ?? "contract"}
                            className="h-7 px-2 text-xs"
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            {contract.fileName ?? "Document"}
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setEditing(contract)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          void contractRepo.update(contract.id, {
                            archived: !contract.archived,
                          })
                        }
                      >
                        {contract.archived ? "Unarchive" : "Archive"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive"
                        onClick={() => {
                          if (window.confirm("Delete this contract?")) {
                            void contractRepo.remove(contract.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export function ContractsSection({
  clientId,
  projects,
}: {
  clientId: string;
  projects: Project[];
}) {
  const { dataMode } = useAppChrome();
  if (dataMode === "cloud") {
    return (
      <p className="text-sm text-muted-foreground">
        Contracts aren&apos;t available in cloud mode yet.
      </p>
    );
  }
  return <ContractsSectionLocal clientId={clientId} projects={projects} />;
}
