"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { ManualEntryDialog } from "@/components/app/manual-entry-dialog";
import {
  clientRepo,
  expenseRepo,
  projectRepo,
  settingsRepo,
  taskRepo,
} from "@/lib/db/repos";
import {
  detectGaps,
  unbilledExpenseIdsForClient,
  unbilledTaskIdsForClient,
  weeklyReckoningSummary,
} from "@/lib/aggregations";
import { formatCurrency, formatDuration } from "@/lib/utils";

const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ReckoningContent() {
  const router = useRouter();
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const expenses = useLiveQuery(() => expenseRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const settings = useLiveQuery(() => settingsRepo.read(), []);

  React.useEffect(() => {
    void settingsRepo.get();
  }, []);

  const now = React.useMemo(() => new Date(), []);

  const summary = React.useMemo(() => {
    if (!tasks || !expenses || !projects || !clients) return null;
    return weeklyReckoningSummary(now, tasks, expenses, projects, clients);
  }, [tasks, expenses, projects, clients, now]);

  const gaps = React.useMemo(() => {
    if (!tasks) return [];
    return detectGaps(now, tasks);
  }, [tasks, now]);

  const gapDays = React.useMemo(() => gaps.filter((g) => g.isGap), [gaps]);

  const markComplete = async () => {
    const s = await settingsRepo.get();
    await settingsRepo.update({
      reckoning: {
        ...s.reckoning,
        lastCompletedAtMs: Date.now(),
      },
    });
    router.push("/dashboard");
  };

  const pushInvoiceForClient = (clientId: string) => {
    if (!tasks || !expenses || !projects) return;
    const tIds = unbilledTaskIdsForClient(clientId, tasks, projects);
    const eIds = unbilledExpenseIdsForClient(clientId, expenses, projects);
    const q = new URLSearchParams();
    if (tIds.length) q.set("tasks", tIds.join(","));
    if (eIds.length) q.set("expenses", eIds.join(","));
    if (!q.toString()) return;
    router.push(`/invoices/new?${q.toString()}`);
  };

  if (!tasks || !expenses || !projects || !clients || !settings || !summary) {
    return (
      <>
        <PageHeader title="Weekly Reckoning" />
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  const reck = settings.reckoning;
  const unbilledTaskTotal = summary.unbilledTaskAmountByClient.reduce(
    (a, r) => a + r.amount,
    0,
  );

  return (
    <>
      <PageHeader
        title="Weekly Reckoning"
        description={`Scheduled: ${DOW_LABELS[reck.dayOfWeek] ?? "?"} at ${String(reck.hourOfDay).padStart(2, "0")}:00 · Change it in Settings.`}
      />

      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tracked this week</CardTitle>
              <CardDescription>Monday–Sunday, all projects</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {formatDuration(summary.trackedWeekMinutes)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Unbilled time (value)</CardTitle>
              <CardDescription>Across all open tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {formatCurrency(unbilledTaskTotal)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Expenses this week</CardTitle>
              <CardDescription>Entries dated in the current week</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {formatCurrency(summary.weekExpenseTotal)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Unbilled portion: {formatCurrency(summary.weekUnbilledExpenseTotal)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Calendar gaps</CardTitle>
              <CardDescription>
                Weekdays 9:00–17:00 with under 2 hours logged
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {gapDays.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add time below if those days look light.
              </p>
            </CardContent>
          </Card>
        </div>

        {gapDays.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Gaps</CardTitle>
              <CardDescription>
                Quick-add defaults to a one-hour block mid-morning on that day.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {gapDays.map((g) => (
                <div
                  key={g.dayStartMs}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{g.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDuration(g.minutesInWindow)} in 9–5 window
                    </p>
                  </div>
                  <ManualEntryDialog
                    key={g.dayStartMs}
                    defaultDayStartMs={g.dayStartMs}
                    trigger={
                      <Button type="button" size="sm" variant="secondary">
                        Add time
                      </Button>
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Invoice unbilled work</CardTitle>
            <CardDescription>
              Opens a new invoice with every open task and expense for that
              client.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.unbilledTaskAmountByClient.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unbilled time right now — you are caught up.
              </p>
            ) : (
              summary.unbilledTaskAmountByClient.map((row) => {
                const tIds = unbilledTaskIdsForClient(
                  row.clientId,
                  tasks,
                  projects,
                );
                const eIds = unbilledExpenseIdsForClient(
                  row.clientId,
                  expenses,
                  projects,
                );
                const disabled = tIds.length === 0 && eIds.length === 0;
                return (
                  <div
                    key={row.clientId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{row.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(row.amount)} unbilled time
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => pushInvoiceForClient(row.clientId)}
                    >
                      <Receipt className="mr-1 h-4 w-4" />
                      New invoice
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-5 w-5" />
              Wrap up
            </CardTitle>
            <CardDescription>
              Marks this week&apos;s reckoning complete so the app won&apos;t
              auto-open this flow again until the next scheduled run.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void markComplete()}>
              Mark reckoning complete
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
