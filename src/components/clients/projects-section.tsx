"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectForm } from "./project-form";
import { projectRepo } from "@/lib/db/repos";
import type { Client, Project } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";

export function ProjectsSection({ client }: { client: Client }) {
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const projects = useLiveQuery(
    () => projectRepo.listByClient(client.id),
    [client.id],
  );

  const active = (projects ?? []).filter((p) => !p.archived);
  const archived = (projects ?? []).filter((p) => p.archived);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Group work into projects. Tasks attach to a project, not a client
            directly.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New project
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border p-4">
          <ProjectForm
            clientDefaultRate={client.defaultRate}
            submitLabel="Add project"
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              await projectRepo.create({
                clientId: client.id,
                name: values.name,
                rateOverride: values.rateOverride,
              });
              setCreating(false);
            }}
          />
        </div>
      )}

      {projects === undefined ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Loading projects…
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        !creating && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-medium">No projects yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a project so you can start tracking time.
              </p>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add project
            </Button>
          </div>
        )
      ) : (
        <ul className="divide-y rounded-lg border">
          {active.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              clientDefaultRate={client.defaultRate}
              editing={editingId === p.id}
              onEdit={() => setEditingId(p.id)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
          {archived.length > 0 && (
            <li className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Archived
            </li>
          )}
          {archived.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              clientDefaultRate={client.defaultRate}
              editing={editingId === p.id}
              onEdit={() => setEditingId(p.id)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({
  project,
  clientDefaultRate,
  editing,
  onEdit,
  onCancelEdit,
}: {
  project: Project;
  clientDefaultRate?: number;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const effectiveRate = project.rateOverride ?? clientDefaultRate;

  if (editing) {
    return (
      <li className="p-4">
        <ProjectForm
          defaultValues={project}
          clientDefaultRate={clientDefaultRate}
          submitLabel="Save"
          onCancel={onCancelEdit}
          onSubmit={async (values) => {
            await projectRepo.update(project.id, {
              name: values.name,
              rateOverride: values.rateOverride,
            });
            onCancelEdit();
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{project.name}</span>
          {project.archived && <Badge variant="outline">Archived</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {effectiveRate != null
            ? `${formatCurrency(effectiveRate)}/hr${
                project.rateOverride != null ? " (override)" : ""
              }`
            : "No rate set"}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Actions for ${project.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              projectRepo.update(project.id, { archived: !project.archived })
            }
          >
            {project.archived ? (
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
    </li>
  );
}
