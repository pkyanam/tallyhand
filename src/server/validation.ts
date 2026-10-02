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

/**
 * Mirror-write timestamps every create schema accepts: the browser sync
 * engine adopts REST rows back with last-write-wins by `updatedAt`, so
 * create payloads may carry the client's `createdAt`/`updatedAt` and the
 * providers honor them instead of stamping server time. These are known
 * keys now — unknown keys still 400 under `.strict()`.
 */
const syncTimestamps = {
  createdAt: dateMs.optional(),
  updatedAt: dateMs.optional(),
};

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
    ...syncTimestamps,
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
    ...syncTimestamps,
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
    invoiceId: optionalId,
    ...syncTimestamps,
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
    invoiceId: optionalId,
    ...syncTimestamps,
  })
  .strict();
export const expensePatchSchema = expenseCreateSchema.partial();

// -- invoices ------------------------------------------------------------
/** Per-line tax fields shared by invoice create/patch line-item inputs. */
const lineItemTaxFields = {
  taxRate: z.number().min(0).max(100).optional(),
  taxLabel: z.string().optional(),
};

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
    ...lineItemTaxFields,
  })
  .strict();

const currencyCode = z.string().regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter ISO code");

/** Localization/payment fields on an invoice; all optional, all patchable. */
const invoiceLocalizationFields = {
  currency: currencyCode.optional(),
  taxRegion: z.enum(["US", "EU"]).optional(),
  sellerTaxId: z.string().optional(),
  sellerTaxIdLabel: z.string().optional(),
  buyerTaxId: z.string().optional(),
  sellerEmailVisible: z.boolean().optional(),
  buyerEmailVisible: z.boolean().optional(),
  serviceStart: dateMs.optional(),
  serviceEnd: dateMs.optional(),
  invoiceType: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentUrl: z.string().optional(),
  bankAccount: z.string().optional(),
  swiftBic: z.string().optional(),
  qrEnabled: z.boolean().optional(),
  qrPayload: z.string().optional(),
  qrDescription: z.string().optional(),
  amountInWords: z.boolean().optional(),
  template: z.enum(["default", "stripe"]).optional(),
};

export const invoiceCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    invoiceNumber: z.string().min(1).optional(),
    issueDate: dateMs,
    dueDate: dateMs.optional(),
    status: z.enum(["draft", "sent", "paid"]).optional(),
    lineItems: z.array(lineItemInputSchema),
    subtotal: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    publicToken: z.string().min(1).optional(),
    cloudLinkEnabled: z.boolean().optional(),
    ...invoiceLocalizationFields,
    // -- dunning records (mirror writes adopt the browser's history) --
    reminderLog: z
      .array(
        z
          .object({ reminderDay: z.number().int(), sentAt: dateMs })
          .strict(),
      )
      .optional(),
    lateFeeApplications: z
      .array(
        z
          .object({ appliedAt: dateMs, amount: z.number().nonnegative() })
          .strict(),
      )
      .optional(),
    overdueNotifiedAt: dateMs.optional(),
    ...syncTimestamps,
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
    cloudLinkEnabled: z.boolean().optional(),
    ...invoiceLocalizationFields,
    // Mirror PATCH writes carry client timestamps; providers honor
    // `updatedAt` and never rewrite `createdAt`.
    createdAt: dateMs.optional(),
    updatedAt: dateMs.optional(),
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
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    projectId: z.string().min(1).optional(),
    name: z.string().min(1, "name is required"),
    mode: z.enum(["fixed", "unbilled"]),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    interval: z.number().int().min(1, "interval must be >= 1"),
    lineItems: z.array(recurringLineInputSchema).default([]),
    startDate: dateMs,
    endDate: dateMs.optional(),
    maxOccurrences: z.number().int().min(1).optional(),
    // Mirror writes adopt the browser's run cursor wholesale.
    nextRunAt: dateMs.optional(),
    lastRunAt: dateMs.optional(),
    occurrences: z.number().int().nonnegative().optional(),
    status: z.enum(["active", "paused", "ended"]).optional(),
    notes: z.string().optional(),
    ...syncTimestamps,
  })
  .strict();
export const recurringSchedulePatchSchema =
  recurringScheduleCreateSchema.partial();

// -- retainers -----------------------------------------------------------
export const retainerCreateSchema = z
  .object({
    id: optionalId,
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
    ...syncTimestamps,
  })
  .strict();
export const retainerPatchSchema = retainerCreateSchema.partial();

// -- mileage -------------------------------------------------------------
export const mileageCreateSchema = z
  .object({
    id: optionalId,
    date: dateMs,
    miles: z.number().positive("miles must be positive"),
    rate: z.number().positive().optional(),
    purpose: z.string().min(1, "purpose is required"),
    clientId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    origin: z.string().optional(),
    destination: z.string().optional(),
    vehicleNote: z.string().optional(),
    isBilled: z.boolean().optional(),
    invoiceId: optionalId,
    ...syncTimestamps,
  })
  .strict();
export const mileagePatchSchema = mileageCreateSchema.partial();

// -- contracts -----------------------------------------------------------
export const contractCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    projectId: z.string().min(1).optional(),
    type: z.enum(["sow", "msa", "nda", "other"]),
    title: z.string().min(1, "title is required"),
    startDate: dateMs,
    endDate: dateMs.optional(),
    renewalNoticeDays: z.number().int().nonnegative().optional(),
    autoRenew: z.boolean().optional(),
    fileB64: z.string().optional(),
    fileName: z.string().optional(),
    notes: z.string().optional(),
    archived: z.boolean().optional(),
    ...syncTimestamps,
  })
  .strict();
export const contractPatchSchema = contractCreateSchema.partial();

// -- tax payments --------------------------------------------------------
export const taxPaymentCreateSchema = z
  .object({
    id: optionalId,
    taxYear: z.number().int().min(2000).max(2100),
    quarter: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    date: dateMs,
    amount: z.number().nonnegative(),
    jurisdiction: z.enum(["federal", "state"]),
    method: z.string().optional(),
    note: z.string().optional(),
    ...syncTimestamps,
  })
  .strict();
export const taxPaymentPatchSchema = taxPaymentCreateSchema.partial();

// -- rate cards ----------------------------------------------------------
export const rateCardLineInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().min(1, "label is required"),
    rate: z.number().nonnegative(),
  })
  .strict();

export const rateCardCreateSchema = z
  .object({
    id: optionalId,
    clientId: z.string().min(1, "clientId is required"),
    projectId: z.string().min(1).optional(),
    name: z.string().min(1, "name is required"),
    defaultRate: z.number().nonnegative(),
    lines: z.array(rateCardLineInputSchema).optional(),
    effectiveFrom: dateMs,
    effectiveTo: dateMs.optional(),
    archived: z.boolean().optional(),
    ...syncTimestamps,
  })
  .strict();
export const rateCardPatchSchema = rateCardCreateSchema.partial();

export { settingsPatchSchema, dunningSettingsSchema } from "../../cli/src/settings-schema";

export type ClientCreate = z.infer<typeof clientCreateSchema>;
export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;
export type RecurringScheduleCreate = z.infer<typeof recurringScheduleCreateSchema>;
export type RetainerCreate = z.infer<typeof retainerCreateSchema>;
export type MileageCreate = z.infer<typeof mileageCreateSchema>;
export type MileagePatch = z.infer<typeof mileagePatchSchema>;
export type ContractCreate = z.infer<typeof contractCreateSchema>;
export type ContractPatch = z.infer<typeof contractPatchSchema>;
export type TaxPaymentCreate = z.infer<typeof taxPaymentCreateSchema>;
export type TaxPaymentPatch = z.infer<typeof taxPaymentPatchSchema>;
export type RateCardCreate = z.infer<typeof rateCardCreateSchema>;
export type RateCardPatch = z.infer<typeof rateCardPatchSchema>;
