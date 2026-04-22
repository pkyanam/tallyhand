"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  clientRepo,
  invoiceRepo,
  projectRepo,
  taskRepo,
} from "@/lib/db/repos";
import {
  recentEntries,
  startOfWeekMonday,
  unbilledByClient,
  weekTotalMinutes,
} from "@/lib/aggregations";
import { formatCurrency, formatDuration } from "@/lib/utils";

export function DashboardContent() {
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);

  const weekStart = React.useMemo(() => startOfWeekMonday(new Date()), []);

  const { weekMinutes, unbilledAmount, activeClients, topUnbilledClients } =
    React.useMemo(() => {
      if (!tasks || !projects || !clients) {
        return {
          weekMinutes: 0,
          unbilledAmount: 0,
          activeClients: 0,
          topUnbilledClients: [] as ReturnType<typeof unbilledByClient>,
        };
      }
      const rows = unbilledByClient(tasks, projects, clients);
      const unbilledAmount = rows.reduce((acc, r) => acc + r.amount, 0);
      return {
        weekMinutes: weekTotalMinutes(tasks, weekStart),
        unbilledAmount,
        activeClients: clients.filter((c) => !c.archived).length,
        topUnbilledClients: rows.slice(0, 5),
      };
    }, [tasks, projects, clients, weekStart]);

  const openInvoiceCount = React.useMemo(() => {
    if (!invoices) return 0;
    return invoices.filter(
      (i) => i.status === "draft" || i.status === "sent",
    ).length;
  }, [invoices]);

  const recent = React.useMemo(
    () => recentEntries(tasks ?? [], 10),
    [tasks],
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hours this week" value={formatDuration(weekMinutes)} />
        <StatCard
          label="Unbilled amount"
          value={formatCurrency(unbilledAmount)}
        />
        <StatCard label="Active clients" value={String(activeClients)} />
        <StatCard
          label="Tracked entries"
          value={String(tasks?.length ?? 0)}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top unbilled clients</CardTitle>
            <CardDescription>
              Estimated billings from unbilled time, by client.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {tasks === undefined ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : topUnbilledClients.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No unbilled time on the books. Nice work.
              </div>
            ) : (
              <ul className="divide-y">
                {topUnbilledClients.map((row) => (
                  <li
                    key={row.clientId}
                    className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                  >
                    <Link
                      href={`/clients/${row.clientId}`}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {row.clientName}
                    </Link>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open invoices</CardTitle>
            <CardDescription>
              Drafts and sent invoices awaiting payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoices === undefined ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">
                  {openInvoiceCount}
                </span>
                <span className="text-sm text-muted-foreground">
                  {openInvoiceCount === 1 ? "invoice" : "invoices"}
                </span>
              </div>
            )}
            {invoices !== undefined && openInvoiceCount === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                You have no draft or sent invoices yet. When you create invoices
                in a future update, they will show up here.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Your ten most recent tracked entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tasks === undefined ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Nothing tracked yet. Start the timer or add an entry manually.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map((t) => {
                const project = projects?.find((p) => p.id === t.projectId);
                const client = project
                  ? clients?.find((c) => c.id === project.clientId)
                  : null;
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 px-6 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {client ? (
                          <Link
                            href={`/clients/${client.id}`}
                            className="hover:underline"
                          >
                            {client.name}
                          </Link>
                        ) : (
                          "Unknown client"
                        )}
                        {project ? ` · ${project.name}` : ""}
                        {" · "}
                        {new Date(t.startAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatDuration(t.durationMinutes)}
                    </div>
                    {t.isBilled && <Badge variant="secondary">Billed</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
