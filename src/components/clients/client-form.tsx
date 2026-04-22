"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Client } from "@/lib/db/types";

const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Enter a valid email",
    ),
  address: z.string().trim().optional(),
  defaultRate: z
    .string()
    .optional()
    .refine((v) => {
      if (!v || v.trim() === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0;
    }, "Rate must be a non-negative number"),
  notes: z.string().trim().optional(),
});

type ClientFormInput = z.input<typeof clientSchema>;
export type ClientFormValues = {
  name: string;
  email?: string;
  address?: string;
  defaultRate?: number;
  notes?: string;
};

export interface ClientFormProps {
  defaultValues?: Partial<Client>;
  submitLabel?: string;
  onSubmit: (values: ClientFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function ClientForm({
  defaultValues,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: ClientFormProps) {
  const form = useForm<ClientFormInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      email: defaultValues?.email ?? "",
      address: defaultValues?.address ?? "",
      defaultRate:
        defaultValues?.defaultRate != null
          ? String(defaultValues.defaultRate)
          : "",
      notes: defaultValues?.notes ?? "",
    },
  });

  const handleSubmit = form.handleSubmit(async (input) => {
    const rate =
      input.defaultRate && input.defaultRate.trim() !== ""
        ? Number(input.defaultRate)
        : undefined;
    await onSubmit({
      name: input.name,
      email: input.email || undefined,
      address: input.address || undefined,
      defaultRate: rate,
      notes: input.notes || undefined,
    });
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          autoFocus
          placeholder="Acme Inc."
          {...form.register("name")}
        />
        {form.formState.errors.name && (
          <p className="text-xs text-destructive">
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="billing@acme.com"
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="defaultRate">Default hourly rate</Label>
          <Input
            id="defaultRate"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="125"
            {...form.register("defaultRate")}
          />
          {form.formState.errors.defaultRate && (
            <p className="text-xs text-destructive">
              {form.formState.errors.defaultRate.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="address">Billing address</Label>
        <Textarea
          id="address"
          rows={3}
          placeholder="Street, city, postal code"
          {...form.register("address")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          rows={3}
          placeholder="Anything you want to remember about this client"
          {...form.register("notes")}
        />
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
