"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clientRepo, expenseRepo, projectRepo } from "@/lib/db/repos";
import { formatCurrency } from "@/lib/utils";
import type { Client, Expense, Project } from "@/lib/db/types";

function ExpenseRow({ expense, clientName, projectName }: { expense: Expense; clientName: string; projectName: string }) {
  const [deleting, setDeleting] = React.useState(false);

  const onDelete = async () => {
    const ok = window.confirm(
      "Delete this expense? This cannot be undone.",
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await expenseRepo.remove(expense.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium tabular-nums">
            {formatCurrency(expense.amount)}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-sm">{expense.category}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {new Date(expense.date).toLocaleDateString()}
          {clientName
            ? ` · ${clientName}${projectName ? ` · ${projectName}` : ""}`
            : projectName
              ? ` · ${projectName}`
              : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          asChild
        >
          <Link
            href={`/expenses/${expense.id}/edit`}
            aria-label="Edit expense"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          disabled={deleting}
          onClick={onDelete}
          aria-label="Delete expense"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

export function ExpensesList() {
  const expenses = useLiveQuery(() => expenseRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);

  const clientById = React.useMemo(() => {
    const m = new Map<string, Client>();
    (clients ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [clients]);

  const projectById = React.useMemo(() => {
    const m = new Map<string, Project>();
    (projects ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [projects]);

  if (expenses === undefined) {
    return (
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex gap-4 px-4 py-4">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (expenses.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <div className="rounded-full bg-muted p-3">
            <Banknote className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No expenses yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Log reimbursable costs and attach them to clients or projects. They
              show up in the Ledger and can be added to invoices.
            </p>
          </div>
          <Button asChild>
            <Link href="/expenses/new">
              <Plus className="mr-1 h-4 w-4" />
              New expense
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {expenses.map((e) => {
            const proj = e.projectId
              ? projectById.get(e.projectId)
              : undefined;
            const client = e.clientId
              ? clientById.get(e.clientId)
              : proj
                ? clientById.get(proj.clientId)
                : undefined;
            return (
              <ExpenseRow
                key={e.id}
                expense={e}
                clientName={client?.name ?? ""}
                projectName={proj?.name ?? ""}
              />
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
