"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectPicker } from "@/components/app/project-picker";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { clientRepo, projectRepo, settingsRepo } from "@/lib/db/repos";
import { DEFAULT_SETTINGS } from "@/lib/db/types";
import { fromDateInputValue, toDateInputValue } from "@/lib/datetime";
import { resizeImageToJpegDataUrl } from "@/lib/receipt-image";
import type { Expense } from "@/lib/db/types";

const OTHER_KEY = "__other__";

const baseSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0;
    }, "Enter a valid amount"),
  date: z.string().min(1, "Date is required"),
  clientId: z.string().optional(),
  note: z.string().optional(),
  // Category: either from list, or "Other" + custom, or free-text when no list
  categoryList: z.string().optional(),
  categoryCustom: z.string().optional(),
  categoryFree: z.string().optional(),
});

type ExpenseFormInput = z.infer<typeof baseSchema>;

export type ExpenseFormValues = {
  amount: number;
  date: number;
  clientId?: string;
  projectId?: string;
  category: string;
  note?: string;
  receiptB64?: string;
};

export interface ExpenseFormProps {
  defaultValues?: Partial<Expense>;
  submitLabel?: string;
  onSubmit: (values: ExpenseFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function ExpenseForm({
  defaultValues,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: ExpenseFormProps) {
  const { showNotice } = useAppChrome();
  const settings = useLiveQuery(() => settingsRepo.read(), []);
  const clients = useLiveQuery(() => clientRepo.list(false), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);

  React.useEffect(() => {
    void settingsRepo.get();
  }, []);

  const categories =
    settings?.expenseCategories ?? DEFAULT_SETTINGS.expenseCategories;
  const hasCategoryList = categories.length > 0;

  const initialClientId = defaultValues?.clientId ?? "";
  const initialProject = defaultValues?.projectId ?? null;

  const [projectId, setProjectId] = React.useState<string | null>(
    initialProject,
  );
  const [receiptB64, setReceiptB64] = React.useState<string | undefined>(
    defaultValues?.receiptB64,
  );
  const [receiptName, setReceiptName] = React.useState<string | null>(null);

  const form = useForm<ExpenseFormInput>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      amount:
        defaultValues?.amount != null ? String(defaultValues.amount) : "",
      date: defaultValues?.date != null
        ? toDateInputValue(defaultValues.date)
        : toDateInputValue(Date.now()),
      clientId: initialClientId || undefined,
      note: defaultValues?.note ?? "",
      categoryList: (() => {
        if (!hasCategoryList) return undefined;
        const c = defaultValues?.category;
        if (!c) return undefined;
        if (categories.includes(c)) return c;
        return OTHER_KEY;
      })(),
      categoryCustom: (() => {
        if (!hasCategoryList) return undefined;
        const c = defaultValues?.category;
        if (c && !categories.includes(c)) return c;
        return "";
      })(),
      categoryFree: !hasCategoryList
        ? (defaultValues?.category ?? "")
        : undefined,
    },
  });

  const listVal = useWatch({ control: form.control, name: "categoryList" });
  const clientId = (useWatch({ control: form.control, name: "clientId" }) ??
    "") as string;

  // Clear project when client is cleared or project no longer matches
  React.useEffect(() => {
    if (projectId == null || !projects) return;
    if (!clientId) {
      setProjectId(null);
      return;
    }
    const p = projects.find((x) => x.id === projectId);
    if (!p) {
      setProjectId(null);
      return;
    }
    if (p.clientId !== clientId) {
      setProjectId(null);
    }
  }, [clientId, projectId, projects]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const { dataUrl, warnLarge } = await resizeImageToJpegDataUrl(file);
      if (warnLarge) {
        showNotice(
          `Receipt is about ${(dataUrl.length * 0.75 / 1024).toFixed(0)} KB after compressing — large images bloat your local database.`,
        );
      }
      setReceiptB64(dataUrl);
      setReceiptName(file.name);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const handleSubmit = form.handleSubmit(async (raw) => {
    const n = Number(raw.amount);
    const date = fromDateInputValue(raw.date);
    if (date == null) {
      form.setError("date", { message: "Invalid date" });
      return;
    }

    let category = "";
    if (hasCategoryList) {
      const list = raw.categoryList;
      if (list === OTHER_KEY) {
        category = (raw.categoryCustom ?? "").trim();
        if (!category) {
          form.setError("categoryCustom", {
            message: "Enter a category name",
          });
          return;
        }
      } else if (list) {
        category = list;
      } else {
        form.setError("categoryList", { message: "Choose a category" });
        return;
      }
    } else {
      category = (raw.categoryFree ?? "").trim();
      if (!category) {
        form.setError("categoryFree", { message: "Category is required" });
        return;
      }
    }

    const cid = raw.clientId?.trim() || undefined;
    const pr = projectId
      ? (projects ?? []).find((p) => p.id === projectId)
      : undefined;
    if (projectId && !pr) {
      setProjectId(null);
      return;
    }
    const resolvedClient = cid || pr?.clientId;

    await onSubmit({
      amount: n,
      date,
      clientId: resolvedClient,
      projectId: pr?.id,
      category,
      note: raw.note?.trim() || undefined,
      receiptB64,
    });
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="exp-amount">
            Amount <span className="text-destructive">*</span>
          </Label>
          <Input
            id="exp-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register("amount")}
          />
          {form.formState.errors.amount && (
            <p className="text-xs text-destructive">
              {form.formState.errors.amount.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-date">
            Date <span className="text-destructive">*</span>
          </Label>
          <Input id="exp-date" type="date" {...form.register("date")} />
          {form.formState.errors.date && (
            <p className="text-xs text-destructive">
              {form.formState.errors.date.message}
            </p>
          )}
        </div>
      </div>

      {hasCategoryList ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              Category <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.watch("categoryList") || ""}
              onValueChange={(v) => form.setValue("categoryList", v || undefined)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_KEY}>Other (custom)</SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.categoryList && (
              <p className="text-xs text-destructive">
                {form.formState.errors.categoryList.message}
              </p>
            )}
          </div>
          {listVal === OTHER_KEY && (
            <div className="space-y-1.5">
              <Label htmlFor="exp-cat-custom">Custom category</Label>
              <Input
                id="exp-cat-custom"
                placeholder="e.g. Subscription"
                {...form.register("categoryCustom")}
              />
              {form.formState.errors.categoryCustom && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.categoryCustom.message}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="exp-cat-free">
            Category <span className="text-destructive">*</span>
          </Label>
          <Input
            id="exp-cat-free"
            placeholder="e.g. Software, Travel"
            {...form.register("categoryFree")}
          />
          {form.formState.errors.categoryFree && (
            <p className="text-xs text-destructive">
              {form.formState.errors.categoryFree.message}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Client</Label>
          <Select
            value={form.watch("clientId") || "__none__"}
            onValueChange={(v) => {
              if (v === "__none__") {
                form.setValue("clientId", undefined);
                setProjectId(null);
              } else {
                form.setValue("clientId", v);
                setProjectId((prev) => {
                  if (!prev || !projects) return null;
                  const p = projects.find((x) => x.id === prev);
                  if (p && p.clientId === v) return prev;
                  return null;
                });
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {(clients ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Project</Label>
          <ProjectPicker
            value={projectId}
            onChange={setProjectId}
            clientIdFilter={clientId || null}
            placeholder="Optional"
            allowClear
            triggerClassName="w-full"
            size="default"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="exp-note">Note</Label>
        <Textarea
          id="exp-note"
          rows={2}
          placeholder="What was this for?"
          {...form.register("note")}
        />
      </div>

      <div className="space-y-2">
        <Label>Receipt (optional)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept="image/*"
            className="max-w-xs cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0];
              void handleFile(f ?? null);
            }}
          />
          {receiptB64 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setReceiptB64(undefined);
                setReceiptName(null);
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
        {receiptName && (
          <p className="text-xs text-muted-foreground">{receiptName}</p>
        )}
        {receiptB64 && (
          <div className="relative h-32 w-48 overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL from user device */}
            <img
              src={receiptB64}
              alt="Receipt preview"
              className="h-full w-full object-contain"
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          <ImageUp className="mb-0.5 mr-1 inline h-3.5 w-3.5" />
          Images are resized (max 1600px) and stored only in this browser.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
