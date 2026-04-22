"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { InvoiceEditor } from "./invoice-editor";
import {
  clientRepo,
  expenseRepo,
  invoiceRepo,
  projectRepo,
  settingsRepo,
  taskRepo,
} from "@/lib/db/repos";
import { newId } from "@/lib/db/id";
import {
  assignNextInvoiceNumber,
  computeDueDate,
  expenseToLineItem,
  formatInvoiceNumber,
  inferClientIdFromSelection,
  invoiceTotals,
  taskToLineItem,
} from "@/lib/invoice-helpers";
import type {
  Expense,
  Invoice,
  InvoiceLineItem,
  Task,
} from "@/lib/db/types";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function NewInvoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showNotice } = useAppChrome();

  const taskIds = React.useMemo(
    () => parseIds(searchParams.get("tasks")),
    [searchParams],
  );
  const expenseIds = React.useMemo(
    () => parseIds(searchParams.get("expenses")),
    [searchParams],
  );

  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const settings = useLiveQuery(() => settingsRepo.read(), []);

  React.useEffect(() => {
    void settingsRepo.get();
  }, []);

  const [hydration, setHydration] = React.useState<
    | { status: "loading" }
    | {
        status: "ready";
        tasks: Task[];
        expenses: Expense[];
        missingTasks: string[];
        missingExpenses: string[];
      }
  >({ status: "loading" });

  React.useEffect(() => {
    if (taskIds.length === 0 && expenseIds.length === 0) {
      setHydration({
        status: "ready",
        tasks: [],
        expenses: [],
        missingTasks: [],
        missingExpenses: [],
      });
      return;
    }
    let cancelled = false;
    (async () => {
      const [taskResults, expenseResults] = await Promise.all([
        Promise.all(taskIds.map((id) => taskRepo.get(id))),
        Promise.all(expenseIds.map((id) => expenseRepo.get(id))),
      ]);
      if (cancelled) return;
      const tasks = taskResults.filter((t): t is Task => !!t);
      const expenses = expenseResults.filter(
        (e): e is Expense => !!e,
      );
      const missingTasks = taskIds.filter(
        (id, i) => !taskResults[i],
      );
      const missingExpenses = expenseIds.filter(
        (id, i) => !expenseResults[i],
      );
      setHydration({
        status: "ready",
        tasks,
        expenses,
        missingTasks,
        missingExpenses,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [taskIds, expenseIds]);

  const [draft, setDraft] = React.useState<Invoice | null>(null);
  const [saving, setSaving] = React.useState(false);
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (initializedRef.current) return;
    if (
      !clients ||
      !projects ||
      !settings ||
      hydration.status !== "ready"
    ) {
      return;
    }
    initializedRef.current = true;

    const { tasks, expenses, missingTasks, missingExpenses } = hydration;
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    const clientIdFromSelection = inferClientIdFromSelection(
      tasks,
      expenses,
      projects,
    );

    const lineItems: InvoiceLineItem[] = [];
    for (const t of tasks) {
      const project = projectById.get(t.projectId);
      const client = project ? clientById.get(project.clientId) : undefined;
      lineItems.push(taskToLineItem(t, project, client));
    }
    for (const e of expenses) {
      lineItems.push(expenseToLineItem(e));
    }

    const { subtotal, total } = invoiceTotals(lineItems);
    const issueDate = Date.now();
    const dueDate = computeDueDate(
      issueDate,
      settings.invoice.paymentTermsDays,
    );

    const previewNumber = formatInvoiceNumber(
      settings.invoice.numberPrefix,
      settings.invoice.nextNumber,
    );

    setDraft({
      id: newId("inv"),
      clientId: clientIdFromSelection ?? "",
      invoiceNumber: previewNumber,
      issueDate,
      dueDate,
      status: "draft",
      lineItems,
      subtotal,
      total,
      createdAt: 0,
      updatedAt: 0,
    });

    const missing = missingTasks.length + missingExpenses.length;
    if (missing > 0) {
      showNotice(
        `${missing} selected ${missing === 1 ? "entry" : "entries"} could not be found and were skipped.`,
      );
    }
  }, [clients, projects, settings, hydration, showNotice]);

  const handleSave = async () => {
    if (!draft || !settings) return;
    if (!draft.clientId) {
      showNotice("Pick a client before saving the invoice.");
      return;
    }
    setSaving(true);
    try {
      const preview = formatInvoiceNumber(
        settings.invoice.numberPrefix,
        settings.invoice.nextNumber,
      );
      let finalNumber = draft.invoiceNumber.trim();
      if (!finalNumber || finalNumber === preview) {
        finalNumber = await assignNextInvoiceNumber();
      }
      const created = await invoiceRepo.create({
        id: draft.id,
        clientId: draft.clientId,
        invoiceNumber: finalNumber,
        issueDate: draft.issueDate,
        dueDate: draft.dueDate,
        status: "draft",
        lineItems: draft.lineItems,
        subtotal: draft.subtotal,
        total: draft.total,
        notes: draft.notes,
      });
      router.replace(`/invoices/${created.id}`);
    } finally {
      setSaving(false);
    }
  };

  if (
    !clients ||
    !projects ||
    !settings ||
    hydration.status !== "ready" ||
    !draft
  ) {
    return (
      <>
        <PageHeader
          title="New invoice"
          description="Preparing draft from your selection…"
        />
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  if (clients.length === 0) {
    return (
      <>
        <PageHeader
          title="New invoice"
          description="You need a client before you can invoice."
          actions={
            <Button asChild variant="outline">
              <Link href="/invoices">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
          }
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Create a client first, then come back here to invoice.
            </p>
            <Button asChild>
              <Link href="/clients/new">Create a client</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Review the draft, then save it to start tracking its status."
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/invoices">
                <ArrowLeft className="mr-1 h-4 w-4" />
                All invoices
              </Link>
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </>
        }
      />

      <InvoiceEditor
        invoice={draft}
        onChange={setDraft}
        settings={settings}
        clients={clients}
      />
    </>
  );
}
