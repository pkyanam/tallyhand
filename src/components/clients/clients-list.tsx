"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { clientRepo, projectRepo, taskRepo } from "@/lib/db/repos";
import type { Client } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";

export function ClientsList() {
  const [tab, setTab] = React.useState<"active" | "archived">("active");
  const [query, setQuery] = React.useState("");

  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const tasks = useLiveQuery(() => taskRepo.list(), []);

  const filtered = React.useMemo(() => {
    if (!clients) return [];
    const needle = query.trim().toLowerCase();
    return clients
      .filter((c) => (tab === "archived" ? c.archived : !c.archived))
      .filter((c) =>
        needle
          ? [c.name, c.email ?? "", c.notes ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          : true,
      );
  }, [clients, tab, query]);

  const projectCountByClient = React.useMemo(() => {
    const map = new Map<string, number>();
    (projects ?? []).forEach((p) => {
      if (p.archived) return;
      map.set(p.clientId, (map.get(p.clientId) ?? 0) + 1);
    });
    return map;
  }, [projects]);

  const lastActivityByClient = React.useMemo(() => {
    const projectToClient = new Map<string, string>();
    (projects ?? []).forEach((p) => projectToClient.set(p.id, p.clientId));
    const map = new Map<string, number>();
    (tasks ?? []).forEach((t) => {
      const clientId = projectToClient.get(t.projectId);
      if (!clientId) return;
      const cur = map.get(clientId) ?? 0;
      if (t.startAt > cur) map.set(clientId, t.startAt);
    });
    return map;
  }, [projects, tasks]);

  const activeCount = (clients ?? []).filter((c) => !c.archived).length;
  const archivedCount = (clients ?? []).filter((c) => c.archived).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="pl-8"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
          <TabsTrigger value="archived">
            Archived ({archivedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {clients === undefined ? (
            <ClientsSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState tab={tab} query={query} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="hidden grid-cols-[1fr_120px_140px_160px_40px] gap-4 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground md:grid">
                  <div>Name</div>
                  <div>Default rate</div>
                  <div>Projects</div>
                  <div>Last activity</div>
                  <div />
                </div>
                <ul className="divide-y">
                  {filtered.map((c) => (
                    <ClientRow
                      key={c.id}
                      client={c}
                      projectCount={projectCountByClient.get(c.id) ?? 0}
                      lastActivity={lastActivityByClient.get(c.id)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClientRow({
  client,
  projectCount,
  lastActivity,
}: {
  client: Client;
  projectCount: number;
  lastActivity?: number;
}) {
  const [busy, setBusy] = React.useState(false);

  const toggleArchive = async () => {
    setBusy(true);
    try {
      await clientRepo.update(client.id, { archived: !client.archived });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid grid-cols-2 gap-4 px-4 py-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[1fr_120px_140px_160px_40px] md:items-center">
      <div className="col-span-2 md:col-span-1">
        <Link
          href={`/clients/${client.id}`}
          className="font-medium hover:underline"
        >
          {client.name}
        </Link>
        {client.email && (
          <div className="text-xs text-muted-foreground">{client.email}</div>
        )}
        {client.archived && (
          <Badge variant="outline" className="mt-1">
            Archived
          </Badge>
        )}
      </div>
      <div className="text-muted-foreground">
        {client.defaultRate != null
          ? `${formatCurrency(client.defaultRate)}/hr`
          : "—"}
      </div>
      <div className="text-muted-foreground">
        {projectCount === 0 ? "—" : `${projectCount} active`}
      </div>
      <div className="text-muted-foreground">
        {lastActivity ? formatRelativeDate(lastActivity) : "—"}
      </div>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Actions for ${client.name}`}
              disabled={busy}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/clients/${client.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleArchive}>
              {client.archived ? (
                <>
                  <ArchiveRestore className="mr-2 h-4 w-4" />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="mr-2 h-4 w-4" />
                  Archive
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function EmptyState({
  tab,
  query,
}: {
  tab: "active" | "archived";
  query: string;
}) {
  if (query) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          No clients match &ldquo;{query}&rdquo;.
        </CardContent>
      </Card>
    );
  }
  if (tab === "archived") {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          No archived clients.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="rounded-full bg-muted p-3">
          <Users className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-medium">No clients yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first client to start tracking time and invoicing.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/clients/new">
            <Plus className="mr-1 h-4 w-4" />
            New client
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ClientsSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function formatRelativeDate(ts: number): string {
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
