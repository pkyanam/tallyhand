import type { Client, Expense, Project, Task } from "@/lib/db/types";
import { formatCurrency, formatDuration } from "@/lib/utils";

export type LedgerExportTask = {
  kind: "task";
  task: Task;
  clientName: string;
  projectName: string;
};

export type LedgerExportExpense = {
  kind: "expense";
  expense: Expense;
  clientName: string;
  projectName: string;
};

export type LedgerExportRow = LedgerExportTask | LedgerExportExpense;

function csvEscape(value: string | number | boolean | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportTasksCsv(rows: LedgerExportTask[]): string {
  const header = [
    "id",
    "date",
    "client",
    "project",
    "name",
    "minutes",
    "billed",
    "tags",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const t = r.task;
    lines.push(
      [
        csvEscape(t.id),
        csvEscape(new Date(t.startAt).toISOString()),
        csvEscape(r.clientName),
        csvEscape(r.projectName),
        csvEscape(t.name),
        csvEscape(t.durationMinutes),
        csvEscape(t.isBilled),
        csvEscape(t.tags.join("; ")),
        csvEscape(t.notes ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function exportExpensesCsv(rows: LedgerExportExpense[]): string {
  const header = [
    "id",
    "date",
    "client",
    "project",
    "category",
    "amount",
    "billed",
    "note",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const e = r.expense;
    lines.push(
      [
        csvEscape(e.id),
        csvEscape(new Date(e.date).toISOString()),
        csvEscape(r.clientName),
        csvEscape(r.projectName),
        csvEscape(e.category),
        csvEscape(e.amount),
        csvEscape(e.isBilled),
        csvEscape(e.note ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function exportCombinedJson(
  rows: LedgerExportRow[],
  clients: Client[],
  projects: Project[],
): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    format: "tallyhand.ledger.v1",
    rows: rows.map((r) =>
      r.kind === "task"
        ? {
            type: "task",
            id: r.task.id,
            startAt: r.task.startAt,
            endAt: r.task.endAt,
            durationMinutes: r.task.durationMinutes,
            name: r.task.name,
            projectId: r.task.projectId,
            projectName: r.projectName,
            clientName: r.clientName,
            tags: r.task.tags,
            notes: r.task.notes,
            isBilled: r.task.isBilled,
            invoiceId: r.task.invoiceId,
          }
        : {
            type: "expense",
            id: r.expense.id,
            date: r.expense.date,
            amount: r.expense.amount,
            category: r.expense.category,
            clientId: r.expense.clientId,
            projectId: r.expense.projectId,
            projectName: r.projectName,
            clientName: r.clientName,
            note: r.expense.note,
            isBilled: r.expense.isBilled,
            invoiceId: r.expense.invoiceId,
          },
    ),
    clients,
    projects,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportMarkdownLedger(rows: LedgerExportRow[]): string {
  const lines: string[] = [
    "# Ledger",
    "",
    `_Generated ${new Date().toLocaleString()}_`,
    "",
    "| When | Client | Project | Entry | Value | Status |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    if (r.kind === "task") {
      const t = r.task;
      const when = new Date(t.startAt).toLocaleString();
      const val = formatDuration(t.durationMinutes);
      const status = t.isBilled ? "Billed" : "Unbilled";
      lines.push(
        `| ${when} | ${r.clientName} | ${r.projectName} | ${t.name.replace(/\|/g, "\\|")} | ${val} | ${status} |`,
      );
    } else {
      const e = r.expense;
      const when = new Date(e.date).toLocaleString();
      const val = formatCurrency(e.amount);
      const status = e.isBilled ? "Billed" : "Unbilled";
      const label = e.note
        ? `${e.category} — ${e.note}`.replace(/\|/g, "\\|")
        : e.category.replace(/\|/g, "\\|");
      lines.push(
        `| ${when} | ${r.clientName} | ${r.projectName} | ${label} | ${val} | ${status} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
