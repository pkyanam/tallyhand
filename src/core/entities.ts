export type ID = string;

import type { DunningConfig } from "./dunning";
import { DEFAULT_DUNNING_CONFIG } from "./dunning";
import type { TaxSettings } from "./tax";
import { DEFAULT_TAX_SETTINGS } from "./tax";

export interface Timestamped {
  createdAt: number;
  updatedAt: number;
}

export interface Client extends Timestamped {
  id: ID;
  name: string;
  email?: string;
  address?: string;
  defaultRate?: number;
  notes?: string;
  archived: boolean;
}

export interface Project extends Timestamped {
  id: ID;
  clientId: ID;
  name: string;
  rateOverride?: number;
  archived: boolean;
}

export interface Task extends Timestamped {
  id: ID;
  projectId: ID;
  name: string;
  startAt: number;
  endAt: number;
  durationMinutes: number;
  notes?: string;
  tags: string[];
  isBilled: boolean;
  invoiceId?: ID;
}

export interface Expense extends Timestamped {
  id: ID;
  clientId?: ID;
  projectId?: ID;
  date: number;
  amount: number;
  category: string;
  note?: string;
  receiptB64?: string;
  isBilled: boolean;
  invoiceId?: ID;
}

export type InvoiceStatus = "draft" | "sent" | "paid";

export interface InvoiceLineItem {
  id: ID;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  /** Only on expense-sourced lines: percent added on top of `rate` (base cost) when computing `amount`. */
  markupPercent?: number;
  sourceType?: "task" | "expense" | "manual";
  sourceId?: ID;
  /**
   * Per-line tax rate as a percent (e.g. 8.5 means 8.5% of `amount`).
   * Undefined/null means no tax on this line.
   */
  taxRate?: number;
  /** Optional per-line tax label override (e.g. "NY sales tax", "VAT 20%"). */
  taxLabel?: string;
}

/** Tax-jurisdiction behavior for an invoice: US sales-tax style or EU VAT style. */
export type TaxRegion = "US" | "EU";

/** PDF template variant for an invoice. */
export type InvoiceTemplate = "default" | "stripe";

export interface Invoice extends Timestamped {
  id: ID;
  clientId: ID;
  invoiceNumber: string;
  issueDate: number;
  dueDate: number;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  total: number;
  notes?: string;
  publicToken?: string;
  /** Dunning: reminder history, one entry per schedule day already sent. */
  reminderLog?: DunningReminderRecord[];
  /** Dunning: automatic late-fee applications, in order. */
  lateFeeApplications?: LateFeeApplicationRecord[];
  /** Dunning: ms epoch when the onInvoiceOverdue hook last fired (once per overdue episode). */
  overdueNotifiedAt?: number;
  // -- invoice localization / payment (all optional; absent = legacy behavior) --
  /** ISO 4217 currency code (e.g. "USD"). Defaults to "USD" (or settings default). */
  currency?: string;
  /** Tax-jurisdiction behavior. Defaults to "US". */
  taxRegion?: TaxRegion;
  /** Seller tax identifier override for this invoice (falls back to settings.business.taxId). */
  sellerTaxId?: string;
  /** Label for the seller tax identifier (falls back to the region default). */
  sellerTaxIdLabel?: string;
  /** Buyer tax identifier (e.g. the client's VAT ID). */
  buyerTaxId?: string;
  /** Show the seller email on the invoice. Defaults to true. */
  sellerEmailVisible?: boolean;
  /** Show the buyer (client) email on the invoice. Defaults to true. */
  buyerEmailVisible?: boolean;
  /** Service period start (ms epoch), optional. */
  serviceStart?: number;
  /** Service period end (ms epoch), optional. */
  serviceEnd?: number;
  /** Document type label, e.g. "Invoice", "Proforma invoice", "Credit note". Defaults to "Invoice". */
  invoiceType?: string;
  /** Payment method text (e.g. "Bank transfer", "Card"). */
  paymentMethod?: string;
  /** URL the client can pay at (e.g. a Stripe payment link). */
  paymentUrl?: string;
  /** Seller bank account (IBAN for EU invoices). */
  bankAccount?: string;
  /** SWIFT/BIC for EU bank transfers. */
  swiftBic?: string;
  /** Render a payment QR code on the PDF. */
  qrEnabled?: boolean;
  /** Custom QR payload override (URL or text). Generated from payment fields when omitted. */
  qrPayload?: string;
  /** Human-readable description shown under the QR code. */
  qrDescription?: string;
  /** Print the total amount in words on the PDF. */
  amountInWords?: boolean;
  /** PDF template variant. Defaults to "default". */
  template?: InvoiceTemplate;
}

/** One dunning reminder already sent for an invoice. */
export interface DunningReminderRecord {
  reminderDay: number;
  sentAt: number;
}

/** One automatically-applied late fee on an invoice. */
export interface LateFeeApplicationRecord {
  appliedAt: number;
  amount: number;
}

export interface Settings {
  id: "singleton";
  business: {
    name: string;
    ownerName: string;
    email: string;
    /** Additional addresses displayed on invoices; never automatic message recipients. */
    billingEmails?: string[];
    address: string;
    taxId: string;
    paymentInstructions: string;
  };
  invoice: {
    numberPrefix: string;
    nextNumber: number;
    logoB64?: string;
    accentColor: string;
    footerText: string;
    paymentTermsDays: number;
    /** Default ISO 4217 currency for new invoices. */
    defaultCurrency: string;
    /** Default tax region for new invoices. */
    defaultTaxRegion: TaxRegion;
    /** Default per-line tax rate (percent) stamped onto new line items. */
    defaultTaxRate: number;
    /** Default label for the seller tax identifier (e.g. "Tax ID", "EIN", "VAT ID"). */
    taxIdLabel: string;
    /** Default payment method text for new invoices. */
    defaultPaymentMethod: string;
    /** Print amount-in-words on new invoices by default. */
    amountInWordsDefault: boolean;
  };
  reckoning: {
    enabled: boolean;
    dayOfWeek: number;
    hourOfDay: number;
    /** When user last completed Weekly Reckoning (auto-open guard). */
    lastCompletedAtMs?: number;
  };
  expenseCategories: string[];
  appearance: {
    theme: "light" | "dark" | "system";
  };
  /** Dunning engine configuration (reminder schedule + late fees). */
  dunning: DunningConfig;
  /** Sole-proprietor tax dashboard preferences. */
  tax: TaxSettings;
  /** Analytics preferences (utilization target, revenue goal). */
  analytics: {
    weeklyBillableTargetHours: number;
    monthlyRevenueTarget: number;
  };
  /**
   * Host-persisted values for plugin settings sections
   * (see PluginSettingsSection): plugin name → field key → value.
   */
  pluginSettings?: Record<string, Record<string, string | number | boolean>>;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "singleton",
  business: {
    name: "",
    ownerName: "",
    email: "",
    billingEmails: [],
    address: "",
    taxId: "",
    paymentInstructions: "",
  },
  invoice: {
    numberPrefix: "INV-",
    nextNumber: 1001,
    accentColor: "#0a0a0a",
    footerText: "Thank you for your business.",
    paymentTermsDays: 14,
    defaultCurrency: "USD",
    defaultTaxRegion: "US",
    defaultTaxRate: 0,
    taxIdLabel: "Tax ID",
    defaultPaymentMethod: "",
    amountInWordsDefault: false,
  },
  reckoning: {
    enabled: true,
    dayOfWeek: 5,
    hourOfDay: 16,
  },
  expenseCategories: [
    "Software",
    "Hardware",
    "Travel",
    "Meals",
    "Office",
    "Other",
  ],
  appearance: {
    theme: "light",
  },
  dunning: { ...DEFAULT_DUNNING_CONFIG },
  tax: { ...DEFAULT_TAX_SETTINGS },
  analytics: { weeklyBillableTargetHours: 40, monthlyRevenueTarget: 0 },
};
