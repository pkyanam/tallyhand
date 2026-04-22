"use client";

import * as React from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import { endOfMonth, startOfMonth } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FileJson,
  FileSpreadsheet,
  FileText,
  LayoutList,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import {
  clientRepo,
  expenseRepo,
  projectRepo,
  taskRepo,
} from "@/lib/db/repos";
import type { Client, Expense, Project, Task } from "@/lib/db/types";
import { startOfWeekMonday } from "@/lib/aggregations";
import {
  downloadText,
  exportCombinedJson,
  exportExpensesCsv,
  exportMarkdownLedger,
  exportTasksCsv,
  type LedgerExportExpense,
  type LedgerExportRow,
  type LedgerExportTask,
} from "@/lib/ledger-export";
import { formatCurrency, formatDuration } from "@/lib/utils";

type UnifiedRow =
  | { kind: "task"; sortAt: number; task: Task }
  | { kind: "expense"; sortAt: number; expense: Expense };

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdStartMs(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).getTime();
}

function ymdEndMs(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
}

function norm(s: string) {
  return s.toLowerCase().trim();
}

function textBlobTask(
  t: Task,
  clientName: string,
  projectName: string,
): string {
  return norm(
    `${t.name} ${t.notes ?? ""} ${t.tags.join(" ")} ${clientName} ${projectName}`,
  );
}

function textBlobExpense(
  e: Expense,
  clientName: string,
  projectName: string,
): string {
  return norm(`${e.category} ${e.note ?? ""} ${clientName} ${projectName}`);
}

function buildRows(tasks: Task[], expenses: Expense[]): UnifiedRow[] {
  const taskRows: UnifiedRow[] = tasks.map((task) => ({
    kind: "task" as const,
    sortAt: task.startAt,
    task,
  }));
  const expenseRows: UnifiedRow[] = expenses.map((expense) => ({
    kind: "expense" as const,
    sortAt: expense.date,
    expense,
  }));
  return [...taskRows, ...expenseRows].sort((a, b) => b.sortAt - a.sortAt);
}

function rowKey(row: UnifiedRow) {
  return row.kind === "task" ? `t:${row.task.id}` : `e:${row.expense.id}`;
}

export function LedgerContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showNotice } = useAppChrome();

  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const expenses = useLiveQuery(() => expenseRepo.list(), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const clientId = searchParams.get("client") ?? "";
  const projectId = searchParams.get("project") ?? "";
  const billed = searchParams.get("billed") ?? "all";
  const tag = searchParams.get("tag") ?? "";
  const q = searchParams.get("q") ?? "";

  const setParams = React.useCallback(
    (patch: Record<string, string>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) sp.delete(k);
        else sp.set(k, v);
      }
      const next = sp.toString();
      router.replace(next ? `${pathname}?${next}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const projectById = React.useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects ?? []) m.set(p.id, p);
    return m;
  }, [projects]);

  const clientById = React.useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients ?? []) m.set(c.id, c);
    return m;
  }, [clients]);

  const resolveClientProject = React.useCallback(
    (task: Task) => {
      const p = projectById.get(task.projectId);
      const c = p ? clientById.get(p.clientId) : undefined;
      return { project: p, client: c };
    },
    [clientById, projectById],
  );

  const resolveExpenseContext = React.useCallback(
    (e: Expense) => {
      const p = e.projectId ? projectById.get(e.projectId) : undefined;
      const cFromP = p ? clientById.get(p.clientId) : undefined;
      const c = e.clientId ? clientById.get(e.clientId) : cFromP;
      return { project: p, client: c };
    },
    [clientById, projectById],
  );

  const merged = React.useMemo(() => {
    if (!tasks || !expenses) return [];
    return buildRows(tasks, expenses);
  }, [tasks, expenses]);

  const filtered = React.useMemo(() => {
    if (!tasks || !expenses || !projects || !clients) return [];
    const fromMs = from ? ymdStartMs(from) : null;
    const toMs = to ? ymdEndMs(to) : null;
    const tagNeedle = tag.trim().toLowerCase();
    const qNeedle = q.trim().toLowerCase();

    return merged.filter((row) => {
      if (row.kind === "task") {
        const t = row.task;
        if (fromMs != null && t.startAt < fromMs) return false;
        if (toMs != null && t.startAt > toMs) return false;
        if (clientId) {
          const { project, client } = resolveClientProject(t);
          if (!project || client?.id !== clientId) return false;
        }
        if (projectId && t.projectId !== projectId) return false;
        if (billed === "yes" && !t.isBilled) return false;
        if (billed === "no" && t.isBilled) return false;
        if (
          tagNeedle &&
          !t.tags.some((x) => x.toLowerCase() === tagNeedle)
        )
          return false;
        if (qNeedle) {
          const { project, client } = resolveClientProject(t);
          const blob = textBlobTask(
            t,
            client?.name ?? "",
            project?.name ?? "",
          );
          if (!blob.includes(qNeedle)) return false;
        }
        return true;
      }
      const e = row.expense;
      if (tagNeedle) return false;
      if (fromMs != null && e.date < fromMs) return false;
      if (toMs != null && e.date > toMs) return false;
      if (clientId) {
        const { project } = resolveExpenseContext(e);
        const effectiveClientId = e.clientId ?? project?.clientId;
        if (effectiveClientId !== clientId) return false;
      }
      if (projectId) {
        if (!e.projectId || e.projectId !== projectId) return false;
      }
      if (billed === "yes" && !e.isBilled) return false;
      if (billed === "no" && e.isBilled) return false;
      if (tagNeedle) return false;
      if (qNeedle) {
        const { project, client } = resolveExpenseContext(e);
        const blob = textBlobExpense(
          e,
          client?.name ?? "",
          project?.name ?? "",
        );
        if (!blob.includes(qNeedle)) return false;
      }
      return true;
    });
  }, [
    billed,
    clientId,
    from,
    merged,
    projectId,
    q,
    resolveClientProject,
    resolveExpenseContext,
    tag,
    tasks,
    expenses,
    projects,
    clients,
    to,
  ]);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const anchorIndex = React.useRef<number | null>(null);
  const shiftRef = React.useRef(false);

  React.useEffect(() => {
    setSelected(new Set());
    anchorIndex.current = null;
  }, [searchParams]);

  const toggleOne = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const onRowSelect = (
    index: number,
    key: string,
    checked: boolean,
    shift: boolean,
  ) => {
    if (shift && anchorIndex.current != null) {
      const a = Math.min(anchorIndex.current, index);
      const b = Math.max(anchorIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = a; i <= b; i++) {
          next.add(rowKey(filtered[i]));
        }
        return next;
      });
    } else {
      toggleOne(key, checked);
      anchorIndex.current = index;
    }
  };

  const exportRows = React.useMemo((): LedgerExportRow[] => {
    const out: LedgerExportRow[] = [];
    for (const row of filtered) {
      if (row.kind === "task") {
        const { project, client } = resolveClientProject(row.task);
        out.push({
          kind: "task",
          task: row.task,
          clientName: client?.name ?? "—",
          projectName: project?.name ?? "—",
        });
      } else {
        const { project, client } = resolveExpenseContext(row.expense);
        out.push({
          kind: "expense",
          expense: row.expense,
          clientName: client?.name ?? "—",
          projectName: project?.name ?? "—",
        });
      }
    }
    return out;
  }, [filtered, resolveClientProject, resolveExpenseContext]);

  const taskExportRows = React.useMemo(
    () => exportRows.filter((r): r is LedgerExportTask => r.kind === "task"),
    [exportRows],
  );
  const expenseExportRows = React.useMemo(
    () =>
      exportRows.filter((r): r is LedgerExportExpense => r.kind === "expense"),
    [exportRows],
  );

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 12,
  });

  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks ?? []) for (const x of t.tags) s.add(x);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const invoiceHref = React.useMemo(() => {
    const taskIds: string[] = [];
    const expenseIds: string[] = [];
    for (const key of Array.from(selected)) {
      if (key.startsWith("t:")) taskIds.push(key.slice(2));
      if (key.startsWith("e:")) expenseIds.push(key.slice(2));
    }
    const sp = new URLSearchParams();
    if (taskIds.length) sp.set("tasks", taskIds.join(","));
    if (expenseIds.length) sp.set("expenses", expenseIds.join(","));
    const qs = sp.toString();
    return qs ? `/invoices/new?${qs}` : "/invoices/new";
  }, [selected]);

  async function seedExpenses() {
    const cs = await clientRepo.list(false);
    const ps = await projectRepo.list();
    if (cs.length === 0) {
      showNotice("Add a client first.");
      return;
    }
    const c = cs[0];
    let p = ps.find((x) => x.clientId === c.id && !x.archived);
    if (!p) {
      p = await projectRepo.create({
        clientId: c.id,
        name: "Misc",
        archived: false,
      });
    }
    for (let i = 0; i < 5; i++) {
      await expenseRepo.create({
        clientId: c.id,
        projectId: p.id,
        date: Date.now() - i * 86_400_000,
        amount: 12.5 + i * 3,
        category: "Software",
        note: `Dev seed ${i + 1}`,
        isBilled: false,
      });
    }
    showNotice("Seeded 5 expenses.");
  }

  const presetThisWeek = () => {
    const ws = startOfWeekMonday(new Date());
    const we = ws + 6 * 86_400_000;
    setParams({
      from: toYmd(new Date(ws)),
      to: toYmd(new Date(we)),
    });
  };

  const presetThisMonth = () => {
    const now = new Date();
    setParams({
      from: toYmd(startOfMonth(now)),
      to: toYmd(endOfMonth(now)),
    });
  };

  const clearDates = () => setParams({ from: "", to: "" });

  const clearFilters = () => {
    setParams({
      from: "",
      to: "",
      client: "",
      project: "",
      billed: "all",
      tag: "",
      q: "",
    });
  };

  const dataLoading =
    tasks === undefined ||
    expenses === undefined ||
    projects === undefined ||
    clients === undefined;
  const hasAnyRows = !dataLoading && merged.length > 0;
  const filtersActive =
    Boolean(from) ||
    Boolean(to) ||
    Boolean(clientId) ||
    Boolean(projectId) ||
    billed !== "all" ||
    Boolean(tag.trim()) ||
    Boolean(q.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="sticky top-0 z-20 space-y-3 rounded-lg border bg-background/95 p-4 backdrop-blur">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">From</span>
            <Input
              type="date"
              className="h-9 w-[11rem]"
              value={from}
              onChange={(e) => setParams({ from: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <Input
              type="date"
              className="h-9 w-[11rem]"
              value={to}
              onChange={(e) => setParams({ to: e.target.value })}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={presetThisWeek}>
            This week
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={presetThisMonth}>
            This month
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearDates}>
            All dates
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            value={clientId || "__all__"}
            onValueChange={(v) =>
              setParams({ client: v === "__all__" ? "" : v, project: "" })
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All clients</SelectItem>
              {(clients ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={projectId || "__all__"}
            onValueChange={(v) =>
              setParams({ project: v === "__all__" ? "" : v })
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All projects</SelectItem>
              {(projects ?? [])
                .filter((p) => !clientId || p.clientId === clientId)
                .map((p) => {
                  const c = clients?.find((x) => x.id === p.clientId);
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {c ? ` · ${c.name}` : ""}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>

          <Select
            value={billed}
            onValueChange={(v) => setParams({ billed: v })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Billed" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Billed</SelectItem>
              <SelectItem value="no">Unbilled</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={tag || "__any__"}
            onValueChange={(v) =>
              setParams({ tag: v === "__any__" ? "" : v })
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Any tag</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="h-9 max-w-xs"
            placeholder="Search…"
            value={q}
            onChange={(e) => setParams({ q: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">Export</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              downloadText(
                "tallyhand-tasks.csv",
                exportTasksCsv(taskExportRows),
                "text/csv;charset=utf-8",
              )
            }
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            CSV (tasks)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              downloadText(
                "tallyhand-expenses.csv",
                exportExpensesCsv(expenseExportRows),
                "text/csv;charset=utf-8",
              )
            }
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            CSV (expenses)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              downloadText(
                "tallyhand-ledger.json",
                exportCombinedJson(
                  exportRows,
                  clients ?? [],
                  projects ?? [],
                ),
                "application/json;charset=utf-8",
              )
            }
          >
            <FileJson className="h-3.5 w-3.5" />
            JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              downloadText(
                "tallyhand-ledger.md",
                exportMarkdownLedger(exportRows),
                "text/markdown;charset=utf-8",
              )
            }
          >
            <FileText className="h-3.5 w-3.5" />
            Markdown
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          JSON is the canonical structured export; Markdown is for reading in
          your notes app.
        </p>

        {process.env.NODE_ENV === "development" ? (
          <div className="flex items-center gap-2 border-t border-dashed pt-3">
            <Button type="button" variant="secondary" size="sm" onClick={seedExpenses}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Seed 5 expenses (dev)
            </Button>
          </div>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-[1px] z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selected.size} selected
          </span>
          <Button asChild size="sm">
            <Link href={invoiceHref}>Invoice selected</Link>
          </Button>
        </div>
      ) : null}

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-card"
        style={{ maxHeight: "min(70vh, 640px)" }}
      >
        {dataLoading ? (
          <div className="space-y-3 p-8">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-16 w-full animate-pulse rounded bg-muted" />
            <div className="h-16 w-full animate-pulse rounded bg-muted" />
            <div className="h-16 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : !hasAnyRows ? (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <LayoutList className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Nothing in your ledger yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Start the timer from the top bar (⌘⇧T), add a manual entry, or
                log an expense. Everything you track shows up here.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" asChild variant="default" size="sm">
                <Link href="/clients/new">Add a client</Link>
              </Button>
              <Button type="button" asChild variant="outline" size="sm">
                <Link href="/expenses/new">New expense</Link>
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
            <p>No entries match these filters.</p>
            {filtersActive ? (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = filtered[vi.index];
              const key = rowKey(row);
              return (
                <div
                  key={key}
                  className="absolute left-0 top-0 w-full border-b"
                  style={{
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`,
                  }}
                  onMouseDown={(e) => {
                    shiftRef.current = e.shiftKey;
                  }}
                >
                  {row.kind === "task" ? (
                    <TaskRow
                      row={row}
                      selected={selected.has(key)}
                      onSelect={(checked) =>
                        onRowSelect(
                          vi.index,
                          key,
                          checked,
                          shiftRef.current,
                        )
                      }
                      resolve={() => resolveClientProject(row.task)}
                    />
                  ) : (
                    <ExpenseRow
                      row={row}
                      selected={selected.has(key)}
                      onSelect={(checked) =>
                        onRowSelect(
                          vi.index,
                          key,
                          checked,
                          shiftRef.current,
                        )
                      }
                      resolve={() => resolveExpenseContext(row.expense)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  row,
  selected,
  onSelect,
  resolve,
}: {
  row: Extract<UnifiedRow, { kind: "task" }>;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  resolve: () => { project?: Project; client?: Client };
}) {
  const t = row.task;
  const { project, client } = resolve();
  const [edit, setEdit] = React.useState<
    null | "name" | "minutes" | "tags"
  >(null);

  const saveName = async (value: string) => {
    const v = value.trim();
    if (v && v !== t.name) await taskRepo.update(t.id, { name: v });
    setEdit(null);
  };

  const saveMinutes = async (value: string) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) {
      setEdit(null);
      return;
    }
    if (n !== t.durationMinutes) await taskRepo.update(t.id, { durationMinutes: n });
    setEdit(null);
  };

  const saveTags = async (value: string) => {
    const tags = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await taskRepo.update(t.id, { tags });
    setEdit(null);
  };

  return (
    <div className="flex items-start gap-2 px-2 py-2 text-sm">
      <div className="flex w-8 shrink-0 items-start justify-center pt-1">
        <Checkbox
          checked={selected}
          onCheckedChange={(c) => onSelect(c === true)}
          aria-label="Select row"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {new Date(t.startAt).toLocaleDateString()}
          </span>
          <span className="shrink-0 select-none text-muted-foreground/60">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate">
            {client ? (
              <Link href={`/clients/${client.id}`} className="hover:underline">
                {client.name}
              </Link>
            ) : (
              "—"
            )}
            <span className="select-none text-muted-foreground/60"> · </span>
            {project?.name ?? "—"}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {edit === "minutes" ? (
              <Input
                autoFocus
                className="h-7 w-16 px-1 text-right text-xs"
                defaultValue={String(t.durationMinutes)}
                inputMode="numeric"
                onBlur={(e) => saveMinutes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    saveMinutes((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setEdit(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="hover:underline"
                onClick={() => setEdit("minutes")}
              >
                {formatDuration(t.durationMinutes)}
              </button>
            )}
          </span>
        </div>
        {edit === "name" ? (
          <Input
            autoFocus
            className="h-8"
            defaultValue={t.name}
            onBlur={(e) => saveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setEdit(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="block w-full truncate text-left font-medium hover:underline"
            onClick={() => setEdit("name")}
          >
            {t.name}
          </button>
        )}
        {t.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {edit === "tags" ? (
              <Input
                autoFocus
                className="h-7 text-xs"
                defaultValue={t.tags.join(", ")}
                onBlur={(e) => saveTags(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    saveTags((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setEdit(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="flex flex-wrap gap-1 text-left"
                onClick={() => setEdit("tags")}
              >
                {t.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </button>
            )}
          </div>
        ) : edit === "tags" ? (
          <Input
            autoFocus
            className="h-7 text-xs"
            placeholder="comma-separated"
            defaultValue=""
            onBlur={(e) => saveTags(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                saveTags((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setEdit(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setEdit("tags")}
          >
            + tags
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        {!t.isBilled ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href={`/invoices/new?tasks=${encodeURIComponent(t.id)}`}>
              Open
            </Link>
          </Button>
        ) : t.invoiceId ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href={`/invoices/${encodeURIComponent(t.invoiceId)}`}>
              Open
            </Link>
          </Button>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            Billed
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          disabled={t.isBilled}
          title={
            t.isBilled
              ? "Remove from invoice before deleting (billed entries are protected)."
              : "Delete this entry"
          }
          aria-label="Delete time entry"
          onClick={() => {
            if (
              !window.confirm(
                "Delete this time entry? This cannot be undone.",
              )
            )
              return;
            void taskRepo.remove(t.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ExpenseRow({
  row,
  selected,
  onSelect,
  resolve,
}: {
  row: Extract<UnifiedRow, { kind: "expense" }>;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  resolve: () => { project?: Project; client?: Client };
}) {
  const e = row.expense;
  const { project, client } = resolve();
  const [edit, setEdit] = React.useState<null | "amount" | "category" | "note">(
    null,
  );

  const saveAmount = async (value: string) => {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n < 0) {
      setEdit(null);
      return;
    }
    if (n !== e.amount) await expenseRepo.update(e.id, { amount: n });
    setEdit(null);
  };

  const saveCategory = async (value: string) => {
    const v = value.trim();
    if (v && v !== e.category) await expenseRepo.update(e.id, { category: v });
    setEdit(null);
  };

  const saveNote = async (value: string) => {
    const v = value.trim();
    if (v !== (e.note ?? "")) await expenseRepo.update(e.id, { note: v || undefined });
    setEdit(null);
  };

  return (
    <div className="flex items-start gap-2 border-l-4 border-l-primary/40 bg-muted/20 px-2 py-2 text-sm">
      <div className="flex w-8 shrink-0 items-start justify-center pt-1">
        <Checkbox
          checked={selected}
          onCheckedChange={(c) => onSelect(c === true)}
          aria-label="Select row"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {new Date(e.date).toLocaleDateString()}
          </span>
          <span className="shrink-0 select-none text-muted-foreground/60">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate">
            {client ? (
              <Link href={`/clients/${client.id}`} className="hover:underline">
                {client.name}
              </Link>
            ) : (
              "—"
            )}
            <span className="select-none text-muted-foreground/60"> · </span>
            {project?.name ?? "—"}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {edit === "amount" ? (
              <Input
                autoFocus
                className="h-7 w-20 px-1 text-right text-xs"
                defaultValue={String(e.amount)}
                inputMode="decimal"
                onBlur={(ev) => saveAmount(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter")
                    saveAmount((ev.target as HTMLInputElement).value);
                  if (ev.key === "Escape") setEdit(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="hover:underline"
                onClick={() => setEdit("amount")}
              >
                {formatCurrency(e.amount)}
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {edit === "category" ? (
            <Input
              autoFocus
              className="h-8 max-w-[200px]"
              defaultValue={e.category}
              onBlur={(ev) => saveCategory(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter")
                  saveCategory((ev.target as HTMLInputElement).value);
                if (ev.key === "Escape") setEdit(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="font-medium hover:underline"
              onClick={() => setEdit("category")}
            >
              {e.category}
            </button>
          )}
          {edit === "note" ? (
            <Input
              autoFocus
              className="h-8 min-w-[120px] flex-1"
              defaultValue={e.note ?? ""}
              onBlur={(ev) => saveNote(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter")
                  saveNote((ev.target as HTMLInputElement).value);
                if (ev.key === "Escape") setEdit(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="truncate text-xs text-muted-foreground hover:underline"
              onClick={() => setEdit("note")}
            >
              {e.note || "Note"}
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        {!e.isBilled ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href={`/invoices/new?expenses=${encodeURIComponent(e.id)}`}>
              Open
            </Link>
          </Button>
        ) : e.invoiceId ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href={`/invoices/${encodeURIComponent(e.invoiceId)}`}>
              Open
            </Link>
          </Button>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            Billed
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          disabled={e.isBilled}
          title={
            e.isBilled
              ? "Remove from invoice before deleting (billed entries are protected)."
              : "Delete this expense"
          }
          aria-label="Delete expense"
          onClick={() => {
            if (
              !window.confirm(
                "Delete this expense? This cannot be undone.",
              )
            )
              return;
            void expenseRepo.remove(e.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
