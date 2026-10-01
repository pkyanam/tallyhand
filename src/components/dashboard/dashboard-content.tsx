"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Clock3, DollarSign, FileText, Users, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clientRepo, invoiceRepo, projectRepo, recurringScheduleRepo, taskRepo } from "@/lib/db/repos";
import { startOfWeekMonday, recentEntries } from "@/core/aggregations";
import { summarizeProjects } from "@/core/project-summary";
import { describeFrequency } from "@/core/recurring";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import type { Task } from "@/core/entities";

function dayAfter(start: number, days: number) { const d = new Date(start); d.setDate(d.getDate() + days); return d.getTime(); }
function completedIn(tasks: Task[], start: number, end: number) { return tasks.filter(t => t.endAt > 0 && t.startAt >= start && t.startAt < end); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
function date(ms: number) { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }

export function DashboardContent() {
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);
  const recurring = useLiveQuery(() => recurringScheduleRepo.list("active"), []);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  const weekStart = startOfWeekMonday(new Date(now));
  const [weekOffset, setWeekOffset] = React.useState(0);
  const chartStart = dayAfter(weekStart, weekOffset * 7);
  const loaded = tasks !== undefined && projects !== undefined && clients !== undefined && invoices !== undefined;
  const currentWeek = React.useMemo(() => completedIn(tasks ?? [], weekStart, dayAfter(weekStart, 7)), [tasks, weekStart]);
  const previousWeek = React.useMemo(() => completedIn(tasks ?? [], dayAfter(weekStart, -7), weekStart), [tasks, weekStart]);
  const minutes = currentWeek.reduce((sum, t) => sum + t.durationMinutes, 0);
  const previousMinutes = previousWeek.reduce((sum, t) => sum + t.durationMinutes, 0);
  const unbilled = React.useMemo(() => {
    const totals = new Map<string, { id: string; name: string; minutes: number; amount: number }>();
    for (const summary of summarizeProjects(projects ?? [], clients ?? [], tasks ?? [], invoices ?? [])) {
      if (!summary.client || summary.readyToInvoiceMinutes <= 0) continue;
      const client = summary.client;
      const row = totals.get(client.id) ?? { id: client.id, name: client.name, minutes: 0, amount: 0 };
      row.minutes += summary.readyToInvoiceMinutes;
      row.amount += summary.readyToInvoiceMinutes / 60 * (summary.project.rateOverride ?? client.defaultRate ?? 0);
      totals.set(client.id, row);
    }
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  }, [projects, clients, tasks, invoices]);
  const openInvoices = React.useMemo(() => (invoices ?? []).filter(i => i.status === "draft" || i.status === "sent").sort((a, b) => a.dueDate - b.dueDate), [invoices]);
  const upcoming = React.useMemo(() => [...(recurring ?? [])].sort((a, b) => a.nextRunAt - b.nextRunAt).slice(0, 3), [recurring]);
  const recent = React.useMemo(() => recentEntries(tasks ?? [], 6), [tasks]);
  const clientById = React.useMemo(() => new Map((clients ?? []).map(c => [c.id, c])), [clients]);
  const projectById = React.useMemo(() => new Map((projects ?? []).map(p => [p.id, p])), [projects]);
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={Clock3} label="Hours this week" value={loaded ? formatDuration(minutes) : "—"} detail="vs. last week" current={minutes} previous={previousMinutes} />
      <Stat icon={DollarSign} label="Unbilled amount" value={loaded ? formatCurrency(unbilled.reduce((sum, row) => sum + row.amount, 0)) : "—"} detail={`across ${unbilled.length} ${unbilled.length === 1 ? "client" : "clients"} · ready to invoice`} />
      <Stat icon={Users} label="Active clients" value={loaded ? String((clients ?? []).filter(c => !c.archived).length) : "—"} detail="in your workspace" />
      <Stat icon={FileText} label="Tracked entries" value={loaded ? String(currentWeek.length) : "—"} detail="this week vs. last week" current={currentWeek.length} previous={previousWeek.length} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.42fr_1fr]">
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Hours {weekOffset === 0 ? "this" : "last"} week</h2>
          <div className="flex items-center gap-3 text-sm">
            <span className="tabular-nums">{formatDuration(completedIn(tasks ?? [], chartStart, dayAfter(chartStart, 7)).reduce((s, t) => s + t.durationMinutes, 0))} total</span>
            <select aria-label="Chart week" value={weekOffset} onChange={e => setWeekOffset(Number(e.target.value))} className="rounded-md border bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value={0}>This week</option><option value={-1}>Last week</option></select>
          </div>
        </div>
        <HoursChart tasks={tasks} start={chartStart} />
      </Card>
      <Card className="min-w-0 p-4 sm:p-5">
        <SectionTitle title="Top unbilled clients" href="/clients" />
        {!loaded ? <Empty>Loading your clients…</Empty> : !unbilled.length ? <Empty>No unbilled time yet. Completed time appears here when it is ready to invoice.</Empty> : <ul className="mt-2 space-y-2.5">
          {unbilled.slice(0, 5).map(row => <li key={row.id}><Link href={`/clients/${row.id}`} className="group flex items-center gap-3 rounded-md py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{initials(row.name)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium group-hover:underline">{row.name}</span><span className="block text-xs text-muted-foreground">{formatDuration(row.minutes)}</span></span>
            <span className="text-sm tabular-nums">{formatCurrency(row.amount)}</span>
          </Link></li>)}
        </ul>}
      </Card>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="min-w-0 p-4 sm:p-5"><SectionTitle title="Open invoices" href="/invoices" />
        {invoices === undefined ? <Empty>Loading invoices…</Empty> : !openInvoices.length ? <Empty>No open invoices. <Link className="underline" href="/invoices/new">Create an invoice</Link> when you’re ready.</Empty> : <div className="mt-2 overflow-x-auto"><table className="dashboard-table"><thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Status</th><th>Due date</th></tr></thead><tbody>{openInvoices.slice(0, 3).map(invoice => {
          const overdue = invoice.status === "sent" && invoice.dueDate < new Date(new Date(now).toDateString()).getTime();
          return <tr key={invoice.id}><td><Link className="font-medium hover:underline" href={`/invoices/${invoice.id}`}>{invoice.invoiceNumber}</Link></td><td className="max-w-[130px] truncate">{clientById.get(invoice.clientId)?.name ?? "Unknown client"}</td><td className="tabular-nums">{formatCurrency(invoice.total, invoice.currency ?? "USD")}</td><td><span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs capitalize", overdue ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-muted text-foreground")}>{overdue ? "Overdue" : invoice.status}</span></td><td className="text-muted-foreground">{date(invoice.dueDate)}</td></tr>;
        })}</tbody></table></div>}
      </Card>
      <Card className="min-w-0 p-4 sm:p-5"><SectionTitle title="Upcoming recurring" href="/invoices/recurring" />
        {recurring === undefined ? <Empty>Loading schedules…</Empty> : !upcoming.length ? <Empty>No upcoming schedules. <Link className="underline" href="/invoices/recurring/new">Create a recurring invoice</Link> to get started.</Empty> : <div className="mt-2 overflow-x-auto"><table className="dashboard-table"><thead><tr><th>Client</th><th>Schedule</th><th>Next run</th><th className="text-right">Amount</th></tr></thead><tbody>{upcoming.map(schedule => <tr key={schedule.id}><td className="max-w-[140px] truncate">{clientById.get(schedule.clientId)?.name ?? "Unknown client"}</td><td><Link className="hover:underline" href={`/invoices/recurring/${schedule.id}/edit`}>{describeFrequency(schedule.frequency, schedule.interval)}</Link></td><td className="text-muted-foreground">{date(schedule.nextRunAt)}</td><td className="text-right tabular-nums">{schedule.mode === "fixed" ? formatCurrency(schedule.lineItems.reduce((sum, line) => sum + line.quantity * line.rate, 0)) : "Unbilled time"}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
    <Card className="min-w-0 p-4 sm:p-5"><SectionTitle title="Recent activity" href="/ledger" />
      {tasks === undefined ? <Empty>Loading activity…</Empty> : !recent.length ? <Empty>Nothing tracked yet. Start the timer or add your first time entry.</Empty> : <div className="mt-2 overflow-x-auto"><table className="dashboard-table"><thead><tr><th>When</th><th>Description</th><th>Project</th><th>Duration</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{recent.map(task => {
        const project = projectById.get(task.projectId);
        return <tr key={task.id}><td className="text-muted-foreground" title={new Date(task.startAt).toLocaleString()}>{date(task.startAt)}</td><td className="w-[42%] max-w-[320px] truncate">{task.name || "Untitled time entry"}</td><td><span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />{project?.name ?? "Unknown project"}</span></td><td className="tabular-nums">{task.endAt > 0 ? formatDuration(task.durationMinutes) : "Running"}</td><td><DropdownMenu><DropdownMenuTrigger asChild><button className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Actions for ${task.name || "time entry"}`}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href="/ledger">Open ledger</Link></DropdownMenuItem>{project && <DropdownMenuItem asChild><Link href={`/ledger?project=${project.id}`}>View project entries</Link></DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></td></tr>;
      })}</tbody></table></div>}
    </Card>
  </div>;
}
function SectionTitle({ title, href }: { title: string; href: string }) {
  return <div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">{title}</h2><Link href={href} aria-label={`View all ${title.toLowerCase()}`} className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground">View all <ArrowRight className="h-3.5 w-3.5" /></Link></div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="flex min-h-28 items-center justify-center px-3 py-7 text-center text-sm leading-relaxed text-muted-foreground">{children}</p>; }
function Stat({ icon: Icon, label, value, detail, current, previous }: { icon: LucideIcon; label: string; value: string; detail: string; current?: number; previous?: number }) {
  const change = previous && current !== undefined ? Math.round((current - previous) / previous * 100) : null;
  return <Card className="flex min-w-0 items-start gap-4 p-4 sm:p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/80"><Icon className="h-6 w-6" strokeWidth={1.9} aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="text-[13px] text-muted-foreground">{label}</p><div className="mt-2 flex flex-wrap items-center gap-3"><p className="text-[27px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>{change !== null && <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium", change > 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground")}>{change > 0 ? <ArrowUp className="h-3 w-3" /> : change < 0 ? <ArrowDown className="h-3 w-3" /> : null}{Math.abs(change)}%</span>}</div><p className="mt-2 text-xs text-muted-foreground">{detail}</p></div></Card>;
}
function HoursChart({ tasks, start }: { tasks: Task[] | undefined; start: number }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const stamp = dayAfter(start, i);
    const minutes = completedIn(tasks ?? [], stamp, dayAfter(stamp, 1)).reduce((sum, task) => sum + task.durationMinutes, 0);
    return { label: new Date(stamp).toLocaleDateString(undefined, { weekday: "short" }), minutes };
  });
  const max = Math.max(8, Math.ceil(Math.max(...days.map(day => day.minutes / 60)) / 4) * 4);
  return <div className="relative pb-7 pl-8" role="img" aria-label={tasks === undefined ? "Loading weekly hours" : days.map(day => `${day.label}: ${formatDuration(day.minutes)}`).join(", ")}>
    <div className="relative h-[144px]">
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-dashed border-border/80" style={{ bottom: `${i * 25}%` }}><span className="absolute -left-8 -top-2 text-[11px] text-muted-foreground">{max * i / 4}h</span></div>)}
      <div className="absolute inset-0 grid grid-cols-7 gap-3 px-2 sm:gap-6">{days.map((day, i) => <div className="relative flex h-full items-end justify-center" key={i}><div className="w-full max-w-14 rounded-t-[3px] bg-gradient-to-t from-foreground/90 to-foreground shadow-sm motion-safe:transition-[height] motion-safe:duration-300" style={{ height: `${day.minutes / 60 / max * 100}%`, minHeight: day.minutes > 0 ? 2 : 0 }} title={`${day.label}: ${formatDuration(day.minutes)}`} /><span className="absolute -bottom-7 text-xs text-muted-foreground">{day.label}</span></div>)}</div>
      {tasks === undefined && <div className="absolute inset-0 flex items-center justify-center bg-background/75 text-sm text-muted-foreground">Loading hours…</div>}
    </div>
  </div>;
}
