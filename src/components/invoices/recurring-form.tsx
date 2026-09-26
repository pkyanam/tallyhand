"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/page-header";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import {
  clientRepo,
  projectRepo,
  recurringScheduleRepo,
} from "@/lib/db/repos";
import {
  fromDateInputValue,
  toDateInputValue,
} from "@/core/datetime";
import { cn } from "@/lib/utils";
import type {
  RecurringFrequency,
  RecurringMode,
} from "@/core/recurring";

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z
    .string()
    .refine(
      (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
      "Qty must be a non-negative number",
    ),
  rate: z
    .string()
    .refine(
      (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
      "Rate must be a non-negative number",
    ),
});

const scheduleSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    clientId: z.string().min(1, "Pick a client"),
    projectId: z.string().optional(),
    mode: z.enum(["fixed", "unbilled"]),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    interval: z
      .string()
      .refine(
        (v) => {
          const n = Number(v);
          return Number.isInteger(n) && n >= 1 && n <= 99;
        },
        "Enter a whole number from 1–99",
      ),
    startDate: z.string().min(1, "Start date is required"),
    endCondition: z.enum(["never", "endDate", "count"]),
    endDate: z.string().optional(),
    maxOccurrences: z.string().optional(),
    lineItems: z.array(lineItemSchema),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (fromDateInputValue(v.startDate) == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Enter a valid date",
      });
    }
    if (v.endCondition === "endDate") {
      if (!v.endDate || fromDateInputValue(v.endDate) == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endDate"],
          message: "Pick an end date",
        });
      }
    }
    if (v.endCondition === "count") {
      const n = Number(v.maxOccurrences);
      if (
        !v.maxOccurrences ||
        v.maxOccurrences.trim() === "" ||
        !Number.isInteger(n) ||
        n < 1
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maxOccurrences"],
          message: "Enter how many invoices to generate",
        });
      }
    }
    if (v.mode === "fixed") {
      const filled = v.lineItems.filter((l) => l.description.trim() !== "");
      if (filled.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lineItems"],
          message: "Add at least one line item",
        });
      }
    }
  });

type ScheduleFormInput = z.input<typeof scheduleSchema>;

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: "weekly", label: "Weeks" },
  { value: "monthly", label: "Months" },
  { value: "quarterly", label: "Quarters" },
  { value: "yearly", label: "Years" },
];

const MODES: { value: RecurringMode; title: string; hint: string }[] = [
  {
    value: "fixed",
    title: "Fixed line items",
    hint: "Invoice the same lines every run — e.g. a monthly retainer fee.",
  },
  {
    value: "unbilled",
    title: "Bill unbilled work",
    hint: "Each run sweeps up this client's unbilled time and expenses.",
  },
];

export function RecurringForm({ scheduleId }: { scheduleId?: string }) {
  const router = useRouter();
  const { showNotice } = useAppChrome();
  const isEdit = !!scheduleId;

  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const existing = useLiveQuery(
    () => (scheduleId ? recurringScheduleRepo.get(scheduleId) : undefined),
    [scheduleId],
  );

  const form = useForm<ScheduleFormInput>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      name: "",
      clientId: "",
      projectId: undefined,
      mode: "fixed",
      frequency: "monthly",
      interval: "1",
      startDate: toDateInputValue(Date.now()),
      endCondition: "never",
      endDate: "",
      maxOccurrences: "",
      lineItems: [{ description: "", quantity: "1", rate: "" }],
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });

  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isEdit || initializedRef.current || !existing) return;
    initializedRef.current = true;
    form.reset({
      name: existing.name,
      clientId: existing.clientId,
      projectId: existing.projectId,
      mode: existing.mode,
      frequency: existing.frequency,
      interval: String(existing.interval),
      startDate: toDateInputValue(existing.startDate),
      endCondition:
        existing.maxOccurrences != null
          ? "count"
          : existing.endDate != null
            ? "endDate"
            : "never",
      endDate:
        existing.endDate != null ? toDateInputValue(existing.endDate) : "",
      maxOccurrences:
        existing.maxOccurrences != null
          ? String(existing.maxOccurrences)
          : "",
      lineItems:
        existing.lineItems.length > 0
          ? existing.lineItems.map((l) => ({
              description: l.description,
              quantity: String(l.quantity),
              rate: String(l.rate),
            }))
          : [{ description: "", quantity: "1", rate: "" }],
      notes: existing.notes ?? "",
    });
  }, [isEdit, existing, form]);

  const mode = form.watch("mode");
  const endCondition = form.watch("endCondition");
  const watchedClientId = form.watch("clientId");
  const clientProjects = React.useMemo(
    () =>
      (projects ?? []).filter(
        (p) => !p.archived && p.clientId === watchedClientId,
      ),
    [projects, watchedClientId],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const startDate = fromDateInputValue(values.startDate);
    if (startDate == null) return;
    const endDate =
      values.endCondition === "endDate" && values.endDate
        ? fromDateInputValue(values.endDate)
        : null;
    const maxOccurrences =
      values.endCondition === "count" && values.maxOccurrences
        ? Number(values.maxOccurrences)
        : undefined;
    const lineItems =
      values.mode === "fixed"
        ? values.lineItems
            .filter((l) => l.description.trim() !== "")
            .map((l) => ({
              description: l.description.trim(),
              quantity: Number(l.quantity),
              rate: Number(l.rate),
            }))
        : [];

    const payload = {
      clientId: values.clientId,
      projectId: values.projectId || undefined,
      name: values.name.trim(),
      mode: values.mode,
      frequency: values.frequency,
      interval: Number(values.interval),
      lineItems,
      startDate,
      endDate: endDate ?? undefined,
      maxOccurrences,
      notes: values.notes?.trim() || undefined,
    };

    if (isEdit && scheduleId) {
      await recurringScheduleRepo.update(scheduleId, payload);
      showNotice("Schedule updated.");
    } else {
      await recurringScheduleRepo.create(payload);
      showNotice("Recurring schedule created.");
    }
    router.push("/invoices/recurring");
  });

  if (isEdit && existing === undefined) {
    return (
      <Card>
        <CardContent className="p-10 text-sm text-muted-foreground">
          Loading schedule…
        </CardContent>
      </Card>
    );
  }
  if (isEdit && existing === null) {
    return (
      <Card>
        <CardContent className="p-10 text-sm text-muted-foreground">
          Schedule not found.{" "}
          <Link href="/invoices/recurring" className="underline">
            Back to recurring invoices
          </Link>
        </CardContent>
      </Card>
    );
  }

  const err = (name: keyof ScheduleFormInput) =>
    form.formState.errors[name]?.message as string | undefined;

  return (
    <>
      <PageHeader
        title={isEdit ? "Edit schedule" : "New recurring schedule"}
        description={
          isEdit
            ? "Change the billing template. Timing and history stay as they are."
            : "Set it once — drafts are generated on schedule for your review."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices/recurring">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />
      <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="rs-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rs-name"
                autoFocus
                placeholder="e.g. Acme monthly retainer"
                {...form.register("name")}
              />
              {err("name") && (
                <p className="text-xs text-destructive">{err("name")}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>
                  Client <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.watch("clientId") || "__none__"}
                  onValueChange={(v) => {
                    form.setValue(
                      "clientId",
                      v === "__none__" ? "" : v,
                      { shouldValidate: true },
                    );
                    form.setValue("projectId", undefined);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clients ?? [])
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {err("clientId") && (
                  <p className="text-xs text-destructive">{err("clientId")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select
                  value={form.watch("projectId") || "__none__"}
                  onValueChange={(v) =>
                    form.setValue(
                      "projectId",
                      v === "__none__" ? undefined : v,
                    )
                  }
                  disabled={!watchedClientId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All projects</SelectItem>
                    {clientProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Scopes “bill unbilled work” to one project.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>What to invoice</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => form.setValue("mode", m.value)}
                    aria-pressed={mode === m.value}
                    className={cn(
                      "rounded-md border p-3 text-left text-sm transition-colors",
                      mode === m.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <div className="font-medium">{m.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {m.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {mode === "fixed" && (
              <div className="space-y-2">
                <Label>Line items</Label>
                {fields.map((field, i) => (
                  <div key={field.id} className="flex gap-2">
                    <Input
                      placeholder="Description"
                      className="flex-1"
                      {...form.register(`lineItems.${i}.description`)}
                    />
                    <Input
                      placeholder="Qty"
                      inputMode="decimal"
                      className="w-20"
                      {...form.register(`lineItems.${i}.quantity`)}
                    />
                    <Input
                      placeholder="Rate"
                      inputMode="decimal"
                      className="w-24"
                      {...form.register(`lineItems.${i}.rate`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(i)}
                      aria-label="Remove line item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ description: "", quantity: "1", rate: "" })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add line
                </Button>
                {form.formState.errors.lineItems?.message && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.lineItems.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Every</Label>
                <Input
                  inputMode="numeric"
                  {...form.register("interval")}
                />
                {err("interval") && (
                  <p className="text-xs text-destructive">{err("interval")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select
                  value={form.watch("frequency")}
                  onValueChange={(v) =>
                    form.setValue("frequency", v as ScheduleFormInput["frequency"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-start">
                  Start date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rs-start"
                  type="date"
                  {...form.register("startDate")}
                />
                {err("startDate") && (
                  <p className="text-xs text-destructive">{err("startDate")}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>End condition</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { value: "never", label: "Never ends" },
                    { value: "endDate", label: "End date" },
                    { value: "count", label: "After N invoices" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => form.setValue("endCondition", o.value)}
                    aria-pressed={endCondition === o.value}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      endCondition === o.value
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted/50",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {endCondition === "endDate" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-end">End date</Label>
                <Input
                  id="rs-end"
                  type="date"
                  className="max-w-xs"
                  {...form.register("endDate")}
                />
                {err("endDate") && (
                  <p className="text-xs text-destructive">{err("endDate")}</p>
                )}
              </div>
            )}
            {endCondition === "count" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-count">Number of invoices</Label>
                <Input
                  id="rs-count"
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  className="max-w-xs"
                  {...form.register("maxOccurrences")}
                />
                {err("maxOccurrences") && (
                  <p className="text-xs text-destructive">
                    {err("maxOccurrences")}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rs-notes">Notes (optional)</Label>
              <Textarea
                id="rs-notes"
                placeholder="Internal notes about this schedule"
                {...form.register("notes")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {isEdit ? "Save changes" : "Create schedule"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/invoices/recurring">Cancel</Link>
          </Button>
        </div>
      </form>
    </>
  );
}
