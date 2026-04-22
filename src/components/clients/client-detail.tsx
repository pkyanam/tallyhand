"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ProjectsSection } from "./projects-section";
import { clientRepo, projectRepo, taskRepo } from "@/lib/db/repos";
import type { Task } from "@/lib/db/types";
import { formatCurrency, formatDuration } from "@/lib/utils";

export function ClientDetail({ clientId }: { clientId: string }) {
  const router = useRouter();
  const client = useLiveQuery(() => clientRepo.get(clientId), [clientId]);
  const projects = useLiveQuery(
    () => projectRepo.listByClient(clientId),
    [clientId],
  );
  const allTasks = useLiveQuery(() => taskRepo.list(), []);

  const projectIds = React.useMemo(
    () => new Set((projects ?? []).map((p) => p.id)),
    [projects],
  );

  const recentTasks = React.useMemo(() => {
    if (!allTasks) return [];
    return allTasks
      .filter((t) => projectIds.has(t.projectId))
      .sort((a, b) => b.startAt - a.startAt)
      .slice(0, 10);
  }, [allTasks, projectIds]);

  if (client === undefined) {
    return (
      <div className="text-sm text-muted-foreground">Loading client…</div>
    );
  }

  if (client === null || client === undefined) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <h2 className="text-lg font-semibold">Client not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This client may have been deleted.
          </p>
          <Button asChild className="mt-4">
            <Link href="/clients">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to clients
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleArchive = async () => {
    await clientRepo.update(client.id, { archived: !client.archived });
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Delete ${client.name}? This cannot be undone. Projects and tasks attached to this client will NOT be deleted.`,
    );
    if (!confirmed) return;
    await clientRepo.remove(client.id);
    router.push("/clients");
  };

  return (
    <>
      <PageHeader
        title={client.name}
        description={client.archived ? "Archived client" : undefined}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/clients">
                <ArrowLeft className="mr-1 h-4 w-4" />
                All clients
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}/edit`}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={handleArchive}>
              {client.archived ? (
                <>
                  <ArchiveRestore className="mr-1 h-4 w-4" />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="mr-1 h-4 w-4" />
                  Archive
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleDelete}>
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-3 pt-6 text-sm">
            {client.archived && (
              <Badge variant="outline" className="mb-2">
                Archived
              </Badge>
            )}
            <DetailRow
              label="Email"
              value={client.email ? (
                <a
                  href={`mailto:${client.email}`}
                  className="text-foreground hover:underline"
                >
                  {client.email}
                </a>
              ) : null}
            />
            <DetailRow
              label="Default rate"
              value={
                client.defaultRate != null
                  ? `${formatCurrency(client.defaultRate)}/hr`
                  : null
              }
            />
            <DetailRow
              label="Address"
              value={
                client.address ? (
                  <span className="whitespace-pre-wrap text-foreground">
                    {client.address}
                  </span>
                ) : null
              }
            />
            {client.notes && (
              <div className="pt-2">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Notes
                </div>
                <p className="mt-1 whitespace-pre-wrap text-foreground">
                  {client.notes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <ProjectsSection client={client} />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Recent activity
            </h2>
            {recentTasks.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No time tracked for this client yet.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {recentTasks.map((t) => (
                      <RecentTaskRow
                        key={t.id}
                        task={t}
                        projectName={
                          (projects ?? []).find((p) => p.id === t.projectId)
                            ?.name ?? "Unknown"
                        }
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-foreground">
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function RecentTaskRow({
  task,
  projectName,
}: {
  task: Task;
  projectName: string;
}) {
  const date = new Date(task.startAt);
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{task.name}</div>
        <div className="text-xs text-muted-foreground">
          {projectName} · {date.toLocaleDateString()}{" "}
          {date.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
      <div className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatDuration(task.durationMinutes)}
      </div>
      {task.isBilled && <Badge variant="secondary">Billed</Badge>}
    </li>
  );
}
