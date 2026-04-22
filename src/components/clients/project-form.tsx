"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "@/lib/db/types";

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  rateOverride: z
    .string()
    .optional()
    .refine((v) => {
      if (!v || v.trim() === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0;
    }, "Rate must be a non-negative number"),
});

type ProjectFormInput = z.input<typeof projectSchema>;
export type ProjectFormValues = {
  name: string;
  rateOverride?: number;
};

export interface ProjectFormProps {
  defaultValues?: Partial<Project>;
  clientDefaultRate?: number;
  submitLabel?: string;
  onSubmit: (values: ProjectFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function ProjectForm({
  defaultValues,
  clientDefaultRate,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: ProjectFormProps) {
  const form = useForm<ProjectFormInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      rateOverride:
        defaultValues?.rateOverride != null
          ? String(defaultValues.rateOverride)
          : "",
    },
  });

  const handleSubmit = form.handleSubmit(async (input) => {
    const rate =
      input.rateOverride && input.rateOverride.trim() !== ""
        ? Number(input.rateOverride)
        : undefined;
    await onSubmit({ name: input.name, rateOverride: rate });
    if (!defaultValues?.id) form.reset();
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="space-y-1.5">
          <Label htmlFor="project-name">
            Project name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="project-name"
            autoFocus
            placeholder="Website redesign"
            {...form.register("name")}
          />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-rate">Rate override</Label>
          <Input
            id="project-rate"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder={
              clientDefaultRate != null ? String(clientDefaultRate) : "—"
            }
            {...form.register("rateOverride")}
          />
          {form.formState.errors.rateOverride && (
            <p className="text-xs text-destructive">
              {form.formState.errors.rateOverride.message}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
