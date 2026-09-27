"use client";

import * as React from "react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clientRepo,
  expenseRepo,
  invoiceRepo,
  mileageRepo,
  projectRepo,
  settingsRepo,
  taskRepo,
} from "@/lib/db/repos";
import {
  clientProfitability,
  collectionRate,
  effectiveHourlyRate,
  monthlyTargetBurnUp,
  outstandingReceivables,
  revenueByMonth,
  totalBillableMinutes,
  utilizationPercent,
} from "@/core/analytics";
import { formatCurrency, formatDuration } from "@/lib/utils";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {value}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function AnalyticsContent() {
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const expenses = useLiveQuery(() => expenseRepo.list(), []);
  const mileage = useLiveQuery(() => mileageRepo.list(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);

  const now = React.useMemo(() => new Date(), []);
  const yearStart = React.useMemo(
    () => new Date(now.getFullYear(), 0, 1).getTime(),
    [now],
  );

  const stats = React.useMemo(() => {
    if (!tasks || !invoices || !projects || !expenses || !mileage || !settings)
      return null;
    const ytdTasks = tasks.filter((t) => t.startAt >= yearStart);
    const billableMinutes = totalBillableMinutes(ytdTasks);
    const collected = invoices
      .filter((i) => i.status === "paid" && i.issueDate >= yearStart)
      .reduce((s, i) => s + i.total, 0);
    const rate = effectiveHourlyRate(collected, billableMinutes);
    const weeksElapsed = Math.max(
      1,
      Math.ceil((now.getTime() - yearStart) / (7 * 24 * 3600 * 1000)),
    );
    const utilization = utilizationPercent(
      billableMinutes,
      settings.analytics.weeklyBillableTargetHours * 60 * weeksElapsed,
    );
    const receivables = outstandingReceivables(invoices, now.getTime());
    const months = revenueByMonth(invoices, 6, now.getTime());
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const profitability = clientProfitability(
      clients ?? [],
      invoices,
      tasks,
      projectsById,
      expenses,
      mileage,
    );
    const burnUp = monthlyTargetBurnUp(
      months,
      settings.analytics.monthlyRevenueTarget,
    );
    return {
      rate,
      utilization,
      collection: collectionRate(invoices),
      receivables,
      months,
      profitability,
      burnUp,
      billableMinutes,
    };
  }, [tasks, invoices, clients, projects, expenses, mileage, settings, yearStart, now]);

  const maxMonthly = Math.max(
    1,
    ...(stats?.months.flatMap((m) => [m.invoiced, m.collected]) ?? [1]),
  );

  const lastBurnUp = stats?.burnUp[stats.burnUp.length - 1];
  const burnUpPct =
    lastBurnUp && lastBurnUp.target > 0
      ? Math.min(100, (lastBurnUp.cumulative / lastBurnUp.target) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Effective hourly rate (${now.getFullYear()})`}
          value={
            stats?.rate != null ? formatCurrency(stats.rate) : "—"
          }
          hint="Collected revenue ÷ billable hours"
        />
        <StatCard
          label="Utilization (YTD)"
          value={
            stats?.utilization != null
              ? `${Math.round(stats.utilization)}%`
              : "—"
          }
          hint={`Billable hours vs ${settings?.analytics.weeklyBillableTargetHours ?? 40}h/week target`}
        />
        <StatCard
          label="Collection rate"
          value={
            stats?.collection != null
              ? `${Math.round(stats.collection * 100)}%`
              : "—"
          }
          hint="Collected ÷ invoiced (all time)"
        />
        <StatCard
          label="Outstanding receivables"
          value={formatCurrency(stats?.receivables.outstanding ?? 0)}
          hint={
            stats && stats.receivables.overdue > 0
              ? `${formatCurrency(stats.receivables.overdue)} overdue across ${stats.receivables.overdueCount} invoices`
              : "Nothing overdue"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by month</CardTitle>
            <CardDescription>
              Invoiced vs collected, last 6 months.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.months.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-foreground" />
                    Invoiced
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
                    Collected
                  </span>
                </div>
                {stats.months.map((m) => {
                  const [y, mo] = m.month.split("-").map(Number);
                  return (
                    <div key={m.month} className="grid grid-cols-[3rem_1fr] items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {MONTH_NAMES[mo - 1]}
                      </span>
                      <div className="space-y-1">
                        <div className="flex h-2.5 items-center gap-2">
                          <div
                            className="h-full rounded-sm bg-foreground"
                            style={{ width: `${(m.invoiced / maxMonthly) * 100}%` }}
                          />
                          <span className="text-xs tabular-nums">
                            {formatCurrency(m.invoiced)}
                          </span>
                        </div>
                        <div className="flex h-2.5 items-center gap-2">
                          <div
                            className="h-full rounded-sm bg-muted-foreground/40"
                            style={{ width: `${(m.collected / maxMonthly) * 100}%` }}
                          />
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatCurrency(m.collected)}
                          </span>
                        </div>
                        <span className="sr-only">{y}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No revenue yet.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revenue target burn-up</CardTitle>
              <CardDescription>
                Cumulative collected vs monthly target.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lastBurnUp && burnUpPct != null ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Collected</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(lastBurnUp.cumulative)} of{" "}
                      {formatCurrency(lastBurnUp.target)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground"
                      style={{ width: `${burnUpPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(burnUpPct)}% of the 6-month target reached.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Set a monthly revenue target below to track burn-up.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Targets</CardTitle>
              <CardDescription>
                Feeds utilization and burn-up. Saved to settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Weekly billable target (hours)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  defaultValue={String(
                    settings?.analytics.weeklyBillableTargetHours ?? 40,
                  )}
                  key={`tgt-hrs-${settings?.analytics.weeklyBillableTargetHours ?? 40}`}
                  onBlur={(e) => {
                    const n = Number.parseFloat(e.target.value);
                    if (Number.isFinite(n) && n >= 0)
                      void settingsRepo.update({
                        analytics: { weeklyBillableTargetHours: n },
                      });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Monthly revenue target ($)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  defaultValue={String(
                    settings?.analytics.monthlyRevenueTarget ?? 0,
                  )}
                  key={`tgt-rev-${settings?.analytics.monthlyRevenueTarget ?? 0}`}
                  onBlur={(e) => {
                    const n = Number.parseFloat(e.target.value);
                    if (Number.isFinite(n) && n >= 0)
                      void settingsRepo.update({
                        analytics: { monthlyRevenueTarget: n },
                      });
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client profitability</CardTitle>
          <CardDescription>
            Cash basis: paid invoices minus expenses and mileage deductions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats && stats.profitability.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Client</th>
                    <th className="py-2 pr-4 text-right font-medium">Hours</th>
                    <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                    <th className="py-2 pr-4 text-right font-medium">Expenses</th>
                    <th className="py-2 pr-4 text-right font-medium">Mileage</th>
                    <th className="py-2 pr-4 text-right font-medium">Eff. rate</th>
                    <th className="py-2 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.profitability.map((row) => (
                    <tr key={row.clientId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.clientName}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatDuration(Math.round(row.hours * 60))}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.expenses)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.mileageDeduction)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.effectiveRate != null
                          ? formatCurrency(row.effectiveRate)
                          : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatCurrency(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No clients with activity yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
