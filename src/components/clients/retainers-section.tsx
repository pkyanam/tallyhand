"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import {
  projectRepo,
  recurringScheduleRepo,
  retainerRepo,
  taskRepo,
} from "@/lib/db/repos";
import { retainerUsage } from "@/core/recurring";
import { formatCurrency } from "@/lib/utils";
import { RetainerDialog } from "./retainer-dialog";
import type { Retainer, RetainerStatus } from "@/core/recurring";

function statusBadge(status: RetainerStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "active":
      return {
        label: "Active",
        className: "badge-positive",
      };
    case "paused":
      return {
        label: "Paused",
        className: "badge-neutral",
      };
    case "depleted":
      return {
        label: "Depleted",
        className: "border-foreground/40 text-foreground",
      };
    default:
      return {
        label: "Ended",
        className: "badge-quiet",
      };
  }
}

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number(h.toFixed(h < 10 ? 1 : 0))} hrs`;
}

function RetainerRow({
  retainer,
  onEdit,
}: {
  retainer: Retainer;
  onEdit: (r: Retainer) => void;
}) {
  const { showNotice } = useAppChrome();
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const schedule = useLiveQuery(
    () =>
      retainer.recurringScheduleId
        ? recurringScheduleRepo.get(retainer.recurringScheduleId)
        : undefined,
    [retainer.recurringScheduleId],
  );

  const usage = React.useMemo(() => {
    if (!tasks || !projects) return null;
    return retainerUsage(
      retainer,
      tasks,
      new Map(projects.map((p) => [p.id, p])),
    );
  }, [retainer, tasks, projects]);

  const badge = statusBadge(retainer.status);
  const depleted =
    retainer.status === "active" &&
    retainer.type === "prepaid-hours" &&
    usage?.remainingMinutes === 0;

  const setStatus = async (status: RetainerStatus, notice: string) => {
    await retainerRepo.update(retainer.id, { status });
    showNotice(notice);
  };

  const handleDelete = async () => {
    const ok = window.confirm(
      `Delete the retainer "${retainer.name}"? This cannot be undone.`,
    );
    if (!ok) return;
    await retainerRepo.remove(retainer.id);
  };

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{retainer.name}</span>
            <Badge variant="outline" className={badge.className}>
              {depleted ? "Depleted" : badge.label}
            </Badge>
            <Badge variant="outline">
              {retainer.type === "prepaid-hours"
                ? "Prepaid hours"
                : "Monthly fee"}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(retainer.amountCents / 100)}
            {retainer.type === "monthly-fee" ? "/mo" : " total"}
            {" · "}
            {new Date(retainer.startDate).toLocaleDateString()}
            {retainer.endDate
              ? ` → ${new Date(retainer.endDate).toLocaleDateString()}`
              : " → ongoing"}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Retainer actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(retainer)}>
              Edit
            </DropdownMenuItem>
            {retainer.status === "paused" ? (
              <DropdownMenuItem
                onClick={() => setStatus("active", `Resumed "${retainer.name}".`)}
              >
                Resume
              </DropdownMenuItem>
            ) : (
              retainer.status === "active" && (
                <DropdownMenuItem
                  onClick={() =>
                    setStatus("paused", `Paused "${retainer.name}".`)
                  }
                >
                  Pause
                </DropdownMenuItem>
              )
            )}
            {retainer.status === "active" && (
              <DropdownMenuItem
                onClick={() =>
                  setStatus("depleted", `Marked "${retainer.name}" depleted.`)
                }
              >
                Mark depleted
              </DropdownMenuItem>
            )}
            {retainer.status !== "ended" && (
              <DropdownMenuItem
                onClick={() => setStatus("ended", `Ended "${retainer.name}".`)}
              >
                End retainer
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {retainer.type === "prepaid-hours" && usage && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${usage.percentUsed ?? 0}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {retainer.totalHours != null ? (
              <>
                {formatHours(usage.usedMinutes)} of{" "}
                {formatHours(retainer.totalHours * 60)} used
                {usage.remainingMinutes != null &&
                  ` · ${formatHours(usage.remainingMinutes)} left`}
              </>
            ) : (
              <>{formatHours(usage.usedMinutes)} tracked</>
            )}
          </div>
        </div>
      )}

      {retainer.type === "monthly-fee" && schedule && (
        <div className="mt-1 text-xs text-muted-foreground">
          Billed by{" "}
          <Link
            href={`/invoices/recurring/${schedule.id}/edit`}
            className="text-foreground hover:underline"
          >
            {schedule.name}
          </Link>{" "}
          · {schedule.status}
        </div>
      )}
    </li>
  );
}

export function RetainersSection({ clientId }: { clientId: string }) {
  const retainers = useLiveQuery(() => retainerRepo.listByClient(clientId), [
    clientId,
  ]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Retainer | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: Retainer) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Retainers</h2>
        <Button variant="outline" size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />
          New retainer
        </Button>
      </div>
      {retainers === undefined ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading retainers…
          </CardContent>
        </Card>
      ) : retainers.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No retainers yet. Track a prepaid block of hours or a flat monthly
            fee for this client.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {retainers.map((r) => (
                <RetainerRow key={r.id} retainer={r} onEdit={openEdit} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <RetainerDialog
        clientId={clientId}
        retainer={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </section>
  );
}
