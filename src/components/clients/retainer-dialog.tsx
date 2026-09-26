"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { recurringScheduleRepo, retainerRepo } from "@/lib/db/repos";
import {
  fromDateInputValue,
  toDateInputValue,
} from "@/core/datetime";
import { cn } from "@/lib/utils";
import type { Retainer, RetainerType } from "@/core/recurring";

const retainerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    type: z.enum(["prepaid-hours", "monthly-fee"]),
    totalHours: z.string().optional(),
    amount: z
      .string()
      .refine(
        (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
        "Amount must be a non-negative number",
      ),
    hourlyRate: z.string().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().optional(),
    notes: z.string().optional(),
    createSchedule: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (fromDateInputValue(v.startDate) == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Enter a valid date",
      });
    }
    if (v.endDate && fromDateInputValue(v.endDate) == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Enter a valid date",
      });
    }
    if (v.type === "prepaid-hours") {
      const n = Number(v.totalHours);
      if (
        !v.totalHours ||
        v.totalHours.trim() === "" ||
        !Number.isFinite(n) ||
        n <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalHours"],
          message: "Enter the prepaid hours",
        });
      }
    }
    if (
      v.hourlyRate &&
      v.hourlyRate.trim() !== "" &&
      (!Number.isFinite(Number(v.hourlyRate)) || Number(v.hourlyRate) < 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hourlyRate"],
        message: "Rate must be a non-negative number",
      });
    }
  });

type RetainerFormInput = z.input<typeof retainerSchema>;

const TYPES: { value: RetainerType; title: string; hint: string }[] = [
  {
    value: "prepaid-hours",
    title: "Prepaid hours",
    hint: "Client pays upfront for a block of hours; usage draws it down.",
  },
  {
    value: "monthly-fee",
    title: "Monthly fee",
    hint: "Flat recurring fee, optionally auto-billed each month.",
  },
];

export function RetainerDialog({
  clientId,
  retainer,
  open,
  onOpenChange,
}: {
  clientId: string;
  retainer?: Retainer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { showNotice } = useAppChrome();
  const isEdit = !!retainer;

  const form = useForm<RetainerFormInput>({
    resolver: zodResolver(retainerSchema),
    defaultValues: {
      name: "",
      type: "prepaid-hours",
      totalHours: "",
      amount: "",
      hourlyRate: "",
      startDate: toDateInputValue(Date.now()),
      endDate: "",
      notes: "",
      createSchedule: true,
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: retainer?.name ?? "",
      type: retainer?.type ?? "prepaid-hours",
      totalHours:
        retainer?.totalHours != null ? String(retainer.totalHours) : "",
      amount:
        retainer != null ? String(retainer.amountCents / 100) : "",
      hourlyRate:
        retainer?.hourlyRate != null ? String(retainer.hourlyRate) : "",
      startDate: toDateInputValue(retainer?.startDate ?? Date.now()),
      endDate:
        retainer?.endDate != null ? toDateInputValue(retainer.endDate) : "",
      notes: retainer?.notes ?? "",
      createSchedule: true,
    });
  }, [open, retainer, form]);

  const type = form.watch("type");

  const onSubmit = form.handleSubmit(async (values) => {
    const startDate = fromDateInputValue(values.startDate);
    if (startDate == null) return;
    const endDate = values.endDate
      ? fromDateInputValue(values.endDate)
      : null;
    const payload = {
      clientId,
      name: values.name.trim(),
      type: values.type,
      totalHours:
        values.type === "prepaid-hours" ? Number(values.totalHours) : undefined,
      amountCents: Math.round(Number(values.amount) * 100),
      hourlyRate:
        values.hourlyRate && values.hourlyRate.trim() !== ""
          ? Number(values.hourlyRate)
          : undefined,
      startDate,
      endDate: endDate ?? undefined,
      notes: values.notes?.trim() || undefined,
    };

    if (isEdit && retainer) {
      await retainerRepo.update(retainer.id, payload);
      showNotice("Retainer updated.");
    } else {
      const created = await retainerRepo.create(payload);
      if (values.type === "monthly-fee" && values.createSchedule) {
        const schedule = await recurringScheduleRepo.create({
          clientId,
          name: `${payload.name} — monthly billing`,
          mode: "fixed",
          frequency: "monthly",
          interval: 1,
          lineItems: [
            {
              description: payload.name,
              quantity: 1,
              rate: payload.amountCents / 100,
            },
          ],
          startDate: payload.startDate,
          endDate: payload.endDate,
          notes: `Auto-created from retainer "${payload.name}".`,
        });
        await retainerRepo.update(created.id, {
          recurringScheduleId: schedule.id,
        });
        showNotice("Retainer created with a monthly billing schedule.");
      } else {
        showNotice("Retainer created.");
      }
    }
    onOpenChange(false);
  });

  const err = (name: keyof RetainerFormInput) =>
    form.formState.errors[name]?.message as string | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit retainer" : "New retainer"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the retainer terms."
              : "Track a prepaid block of hours or a flat monthly fee."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rtn-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rtn-name"
              autoFocus
              placeholder="e.g. Q1 support block"
              {...form.register("name")}
            />
            {err("name") && (
              <p className="text-xs text-destructive">{err("name")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => form.setValue("type", t.value)}
                  aria-pressed={type === t.value}
                  className={cn(
                    "rounded-md border p-3 text-left text-sm transition-colors",
                    type === t.value
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium">{t.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {type === "prepaid-hours" && (
              <div className="space-y-1.5">
                <Label htmlFor="rtn-hours">
                  Prepaid hours <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rtn-hours"
                  inputMode="decimal"
                  placeholder="e.g. 40"
                  {...form.register("totalHours")}
                />
                {err("totalHours") && (
                  <p className="text-xs text-destructive">
                    {err("totalHours")}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rtn-amount">
                Amount ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rtn-amount"
                inputMode="decimal"
                placeholder="e.g. 2000"
                {...form.register("amount")}
              />
              {err("amount") && (
                <p className="text-xs text-destructive">{err("amount")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rtn-rate">Hourly rate ($, optional)</Label>
              <Input
                id="rtn-rate"
                inputMode="decimal"
                placeholder="e.g. 100"
                {...form.register("hourlyRate")}
              />
              {err("hourlyRate") && (
                <p className="text-xs text-destructive">{err("hourlyRate")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rtn-start">
                Start date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rtn-start"
                type="date"
                {...form.register("startDate")}
              />
              {err("startDate") && (
                <p className="text-xs text-destructive">{err("startDate")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rtn-end">End date (optional)</Label>
              <Input id="rtn-end" type="date" {...form.register("endDate")} />
              {err("endDate") && (
                <p className="text-xs text-destructive">{err("endDate")}</p>
              )}
            </div>
          </div>

          {!isEdit && type === "monthly-fee" && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                {...form.register("createSchedule")}
              />
              <span>
                Create a monthly billing schedule
                <span className="block text-xs text-muted-foreground">
                  A fixed recurring invoice for this amount, starting on the
                  retainer start date.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rtn-notes">Notes (optional)</Label>
            <Textarea
              id="rtn-notes"
              placeholder="Internal notes about this retainer"
              {...form.register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {isEdit ? "Save changes" : "Create retainer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
