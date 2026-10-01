"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderOpen, Play, Plus, Search } from "lucide-react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { clientRepo, projectRepo, taskRepo, invoiceRepo } from "@/lib/db/repos";
import { summarizeProjects } from "@/core/project-summary";
import { formatDuration } from "@/lib/utils";
import { useTimerStore } from "@/lib/timer-store";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { notifyDataChanged } from "@/lib/data/data-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectForm } from "@/components/clients/project-form";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ProjectsContent() {
  const [creating, setCreating] = useState(false);
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("active");
  const { showNotice } = useAppChrome();
  const running = useTimerStore((state) => state.running);
  const pending = useTimerStore((state) => state.pending);
  const start = useTimerStore((state) => state.start);
  const data = useLiveQuery(async () => {
    try {
      const [projects, clients, tasks, invoices] = await Promise.all([
        projectRepo.list(), clientRepo.list(true), taskRepo.list(), invoiceRepo.list(),
      ]);
      return { rows: summarizeProjects(projects, clients, tasks, invoices), clients: clients.filter((client) => !client.archived), failed: false };
    } catch { return { rows: [], clients: [], failed: true }; }
  }, []);
  const rows = useMemo(() => (data?.rows ?? []).filter((row) =>
    row.archived === (tab === "archived") &&
    `${row.project.name} ${row.client?.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [data, query, tab]);

  if (!data) return <p role="status" className="rounded-lg border p-6 text-muted-foreground">Loading projects…</p>;
  if (data.failed) return <div role="alert" className="rounded-lg border p-6 space-y-3">
    <p>Couldn’t load your projects. Check your connection and try again.</p>
    <Button variant="outline" onClick={notifyDataChanged}>Try again</Button>
  </div>;

  const clients = data.clients ?? [];
  const selectedClient = clients.find((client) => client.id === clientId);
  return <div className="space-y-5">
    <div className="flex justify-end"><Button onClick={() => { setClientId(clients[0]?.id ?? ""); setCreating(true); }} disabled={creating}>
      <Plus className="mr-1 h-4 w-4" />New project
    </Button></div>
    {creating && <section aria-label="New project" className="rounded-lg border p-5 space-y-4">
      {clients.length ? <>
        <div className="space-y-1.5"><Label htmlFor="new-project-client">Client</Label>
          <select id="new-project-client" value={clientId} disabled={saving} onChange={(event) => setClientId(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </div>
        <ProjectForm clientDefaultRate={selectedClient?.defaultRate} submitLabel="Create project" onCancel={() => setCreating(false)} onSubmit={async (values) => {
          if (!selectedClient || saving) return;
          setSaving(true);
          try {
            await projectRepo.create({ clientId: selectedClient.id, ...values });
            notifyDataChanged(); setCreating(false); setQuery(""); setTab("active");
            showNotice(`Created ${values.name}`);
          } finally { setSaving(false); }
        }} />
      </> : <div className="space-y-3"><p>Add an active client before creating a project.</p>
        <Button asChild variant="outline"><Link href="/clients">Add a client</Link></Button>
        <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
      </div>}
    </section>}
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        ["Active projects", String(data.rows.filter((row) => !row.archived).length)],
        ["Tracked time", formatDuration(data.rows.reduce((sum, row) => sum + row.trackedMinutes, 0))],
        ["Ready to invoice", formatDuration(data.rows.reduce((sum, row) => sum + row.readyToInvoiceMinutes, 0))],
      ].map(([label, value]) => <div key={label} className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>
      </div>)}
    </div>
    <p className="text-sm text-muted-foreground">Ready-to-invoice time excludes running timers and time already attached to an invoice, including drafts.</p>
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={tab} onValueChange={setTab}><TabsList>
        <TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archived">Archived</TabsTrigger>
      </TabsList></Tabs>
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search projects or clients" placeholder="Search projects or clients…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    </div>
    {!rows.length ? <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
      <FolderOpen className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-semibold">{query ? "No matching projects" : `No ${tab} projects yet`}</h2>
      <p className="text-sm text-muted-foreground">{query ? "Try another project or client name." : "Projects belong to clients. Open a client to add or manage their projects."}</p>
      <Button asChild variant="outline"><Link href="/clients">Go to clients</Link></Button>
    </div> : <ul className="grid gap-4 lg:grid-cols-2">
      {rows.map((row) => <li key={row.project.id} className="rounded-lg border p-5 space-y-4">
        <div className="flex items-start justify-between gap-3"><div>
          <h2 className="font-semibold">{row.project.name}</h2>
          {row.client ? <Link href={`/clients/${encodeURIComponent(row.client.id)}`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">{row.client.name}</Link>
            : <p className="text-sm text-muted-foreground">Client unavailable</p>}
        </div>{row.archived && <Badge variant="secondary">Archived</Badge>}</div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">Tracked</dt><dd className="font-medium">{formatDuration(row.trackedMinutes)}</dd></div>
          <div><dt className="text-muted-foreground">Ready to invoice</dt><dd className="font-medium">{formatDuration(row.readyToInvoiceMinutes)}</dd></div>
        </dl>
        {row.reservedMinutes > 0 && <p className="text-xs text-muted-foreground">{formatDuration(row.reservedMinutes)} reserved on invoices that haven’t been marked billed.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={running || !!pending || row.archived || !row.client} onClick={() => {
            // Recheck the store at click time, not just the last render.
            const timer = useTimerStore.getState();
            if (timer.running || timer.pending) return;
            start(row.project.id); showNotice(`Timer started for ${row.project.name}`);
          }}><Play className="mr-1 h-3.5 w-3.5" />Start timer</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/ledger?project=${encodeURIComponent(row.project.id)}`}>View work</Link></Button>
          <Button size="sm" variant="ghost" asChild><Link href={`/ledger?project=${encodeURIComponent(row.project.id)}&billed=no`}>Review billing</Link></Button>
        </div>
      </li>)}
    </ul>}
    {(running || pending) && <p role="status" className="text-sm text-muted-foreground">Finish or save your current timer entry before starting another project.</p>}
  </div>;
}
