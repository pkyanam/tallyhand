import { z } from "zod";

// -- dunning (settings sub-schema) ----------------------------------------
export const dunningSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    reminderDays: z.array(z.number().int().nonnegative()).optional(),
    escalatingTone: z.boolean().optional(),
    lateFee: z
      .object({
        enabled: z.boolean().optional(),
        type: z.enum(["flat", "percent"]).optional(),
        amount: z.number().nonnegative().optional(),
        graceDays: z.number().int().nonnegative().optional(),
        recurring: z.enum(["once", "monthly"]).optional(),
        maxTotal: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

// -- settings ------------------------------------------------------------
export const settingsPatchSchema = z
  .object({
    business: z
      .object({
        name: z.string().optional(),
        ownerName: z.string().optional(),
        email: z.union([z.string().email(), z.literal("")]).optional().describe("One primary business contact address; use billingEmails for additional invoice-display contacts"),
        billingEmails: z.array(z.string().email()).max(10).optional().describe("Additional email addresses displayed on invoices. Does not add message recipients."),
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
        defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Use an uppercase three-letter currency code").optional(),
        defaultTaxRegion: z.enum(["US", "EU"]).optional(),
        defaultTaxRate: z.number().min(0).max(100).optional(),
        taxIdLabel: z.string().optional(),
        defaultPaymentMethod: z.string().optional(),
        amountInWordsDefault: z.boolean().optional(),
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
    dunning: dunningSettingsSchema,
    tax: z
      .object({
        setAsidePercent: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    analytics: z
      .object({
        weeklyBillableTargetHours: z.number().nonnegative().optional(),
        monthlyRevenueTarget: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    pluginSettings: z
      .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
      .optional(),
  })
  .strict();


export const settingsPatchJsonSchema = z.toJSONSchema(settingsPatchSchema);
