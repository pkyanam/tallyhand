/**
 * SERVER ONLY — never import from client components.
 *
 * Zod (v4) schemas for API v1 create + patch inputs, one per entity.
 * Strict: unknown keys are rejected, required fields enforced, enums
 * closed, numbers must be >= 0 where money/counts are involved.
 *
 * Dates: accepted as millisecond epoch numbers OR date strings
 * (anything Date.parse handles); coerced to ms numbers.
 */
import { z } from "zod";

/** Millisecond epoch or date string → ms number. */
const dateMs = z
  .union([z.number().int(), z.string().min(1)])
  .transform((value, ctx) => {
    if (typeof value === "number") return value;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      ctx.addIssue({ code: "custom", message: `Invalid date: ${value}` });
      return z.NEVER;
    }
    return ms;
  });

const optionalId = z.string().min(1).optional();

// -- clients -------------------------------------------------------------
export const clientCreateSchema = z
  .object({
    id: optionalId,
    name: z.string().min(1, "name is required"),
    email: z.string().email().optional(),
    address: z.string().optional(),
    defaultRate: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const clientPatchSchema = clientCreateSchema.partial();

// -- projects ------------------------------------------------------------
export const projectCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    name: z.string().min(1, "name is required"),
    rateOverride: z.number().nonnegative().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const projectPatchSchema = projectCreateSchema.partial();

// -- tasks ---------------------------------------------------------------
export const taskCreateSchema = z
  .object({
    id: optionalId,
    projectId: z.string().min(1, "projectId is required"),
    name: z.string().min(1, "name is required"),
    startAt: dateMs,
    endAt: dateMs,
    durationMinutes: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isBilled: z.boolean().optional(),
  })
  .strict();
export const taskPatchSchema = taskCreateSchema.partial();

// -- expenses ------------------------------------------------------------
export const expenseCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    date: dateMs,
    amount: z.number().nonnegative(),
    category: z.string().min(1, "category is required"),
    note: z.string().optional(),
    receiptB64: z.string().optional(),
    isBilled: z.boolean().optional(),
  })
  .strict();
export const expensePatchSchema = expenseCreateSchema.partial();

// -- invoices ------------------------------------------------------------
export const lineItemInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    description: z.string().min(1, "description is required"),
    quantity: z.number().nonnegative(),
    rate: z.number().nonnegative(),
    amount: z.number().nonnegative().optional(),
    markupPercent: z.number().optional(),
    sourceType: z.enum(["task", "expense", "manual"]).optional(),
    sourceId: z.string().min(1).optional(),
  })
  .strict();

export const invoiceCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    invoiceNumber: z.string().min(1).optional(),
    issueDate: dateMs,
    dueDate: dateMs,
    status: z.enum(["draft", "sent", "paid"]).optional(),
    lineItems: z.array(lineItemInputSchema),
    subtotal: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    publicToken: z.string().min(1).optional(),
  })
  .strict();
export const invoicePatchSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    invoiceNumber: z.string().min(1).optional(),
    issueDate: dateMs.optional(),
    dueDate: dateMs.optional(),
    status: z.enum(["draft", "sent", "paid"]).optional(),
    lineItems: z.array(lineItemInputSchema).optional(),
    subtotal: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    publicToken: z.string().min(1).optional(),
  })
  .strict();

// -- recurring schedules -------------------------------------------------
export const recurringLineInputSchema = z
  .object({
    description: z.string().min(1, "description is required"),
    quantity: z.number().nonnegative(),
    rate: z.number().nonnegative(),
  })
  .strict();

export const recurringScheduleCreateSchema = z
  .object({
    clientId: z.string().min(1, "clientId is required"),
    projectId: z.string().min(1).optional(),
    name: z.string().min(1, "name is required"),
    mode: z.enum(["fixed", "unbilled"]),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    interval: z.number().int().min(1, "interval must be >= 1"),
    lineItems: z.array(recurringLineInputSchema),
    startDate: dateMs,
    endDate: dateMs.optional(),
    maxOccurrences: z.number().int().min(1).optional(),
    status: z.enum(["active", "paused", "ended"]).optional(),
    notes: z.string().optional(),
  })
  .strict();
export const recurringSchedulePatchSchema =
  recurringScheduleCreateSchema.partial();

// -- retainers -----------------------------------------------------------
export const retainerCreateSchema = z
  .object({
    clientId: z.string().min(1, "clientId is required"),
    name: z.string().min(1, "name is required"),
    type: z.enum(["prepaid-hours", "monthly-fee"]),
    totalHours: z.number().nonnegative().optional(),
    amountCents: z.number().int().nonnegative(),
    hourlyRate: z.number().nonnegative().optional(),
    startDate: dateMs,
    endDate: dateMs.optional(),
    status: z.enum(["active", "paused", "depleted", "ended"]).optional(),
    recurringScheduleId: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .strict();
export const retainerPatchSchema = retainerCreateSchema.partial();

// -- settings ------------------------------------------------------------
export const settingsPatchSchema = z
  .object({
    business: z
      .object({
        name: z.string().optional(),
        ownerName: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        taxId: z.string().optional(),
        paymentInstructions: z.string().optional(),
      })
      .strict()
      .optional(),
    invoice: z
      .object({
        numberPrefix: z.string().optional(),
        nextNumber: z.number().int().nonnegative().optional(),
        logoB64: z.string().optional(),
        accentColor: z.string().optional(),
        footerText: z.string().optional(),
        paymentTermsDays: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    reckoning: z
      .object({
        enabled: z.boolean().optional(),
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        hourOfDay: z.number().int().min(0).max(23).optional(),
        lastCompletedAtMs: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    expenseCategories: z.array(z.string()).optional(),
    appearance: z
      .object({
        theme: z.enum(["light", "dark", "system"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ClientCreate = z.infer<typeof clientCreateSchema>;
export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;
export type RecurringScheduleCreate = z.infer<typeof recurringScheduleCreateSchema>;
export type RetainerCreate = z.infer<typeof retainerCreateSchema>;
