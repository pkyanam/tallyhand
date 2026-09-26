import { newId } from "@/core/id";
import type {
  Client,
  Expense,
  Invoice,
  InvoiceLineItem,
  Project,
  Task,
  TaxRegion,
} from "@/core/entities";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLineAmount(quantity: number, rate: number): number {
  return round2(quantity * rate);
}

/** Expense line: `rate` is the base (pre-markup) cost. */
export function computeExpenseLineAmount(
  baseRate: number,
  quantity: number,
  markupPercent?: number,
): number {
  const m = markupPercent ?? 0;
  return round2(quantity * baseRate * (1 + m / 100));
}

export function computeLineItemAmount(line: InvoiceLineItem): number {
  if (line.sourceType === "expense") {
    return computeExpenseLineAmount(
      line.rate,
      line.quantity,
      line.markupPercent,
    );
  }
  return computeLineAmount(line.quantity, line.rate);
}

export function sumLineItems(items: InvoiceLineItem[]): number {
  return round2(items.reduce((acc, it) => acc + (it.amount ?? 0), 0));
}

const MS_PER_DAY = 86_400_000;

export function computeDueDate(issueDate: number, termsDays: number): number {
  return issueDate + termsDays * MS_PER_DAY;
}

export function formatInvoiceNumber(prefix: string, next: number): string {
  return `${prefix}${next}`;
}

export function taskToLineItem(
  task: Task,
  project?: Project,
  client?: Client,
): InvoiceLineItem {
  const hours = round2(task.durationMinutes / 60);
  const rate = project?.rateOverride ?? client?.defaultRate ?? 0;
  return {
    id: newId("li"),
    description: task.name,
    quantity: hours,
    rate,
    amount: computeLineAmount(hours, rate),
    sourceType: "task",
    sourceId: task.id,
  };
}

export function expenseToLineItem(
  expense: Expense,
  options?: { markupPercent?: number },
): InvoiceLineItem {
  const description = expense.note
    ? `${expense.category} — ${expense.note}`
    : expense.category;
  const markup = options?.markupPercent;
  return {
    id: newId("li"),
    description,
    quantity: 1,
    rate: expense.amount,
    amount: computeExpenseLineAmount(expense.amount, 1, markup),
    sourceType: "expense",
    sourceId: expense.id,
    ...(markup != null && markup !== 0 ? { markupPercent: markup } : {}),
  };
}

export function makeManualLineItem(defaultTaxRate?: number): InvoiceLineItem {
  return {
    id: newId("li"),
    description: "",
    quantity: 1,
    rate: 0,
    amount: 0,
    sourceType: "manual",
    ...(defaultTaxRate ? { taxRate: defaultTaxRate } : {}),
  };
}

export function inferClientIdFromSelection(
  tasks: Task[],
  expenses: Expense[],
  projects: Project[],
): string | undefined {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  for (const t of tasks) {
    const p = projectById.get(t.projectId);
    if (p?.clientId) return p.clientId;
  }
  for (const e of expenses) {
    if (e.clientId) return e.clientId;
    if (e.projectId) {
      const p = projectById.get(e.projectId);
      if (p?.clientId) return p.clientId;
    }
  }
  return undefined;
}

export function invoiceTotals(items: InvoiceLineItem[]): {
  subtotal: number;
  total: number;
} {
  const { subtotal, total } = invoiceTaxTotals(items);
  return { subtotal, total };
}

/** Tax on one line: `taxRate` percent of the line `amount`, rounded to cents. */
export function lineItemTaxAmount(line: InvoiceLineItem): number {
  const rate = line.taxRate ?? 0;
  if (!rate) return 0;
  return round2((line.amount * rate) / 100);
}

export interface TaxGroup {
  /** Tax rate percent shared by every line in this group. */
  rate: number;
  /**
   * Uniform per-line `taxLabel` when every line in the group set the same
   * one; null when lines disagree or none set one (caller falls back to a
   * region-aware default like "Sales tax (8.5%)").
   */
  label: string | null;
  /** Sum of line amounts this tax applies to. */
  taxable: number;
  /** Sum of tax for this group. */
  tax: number;
}

export interface InvoiceTaxTotals {
  subtotal: number;
  taxTotal: number;
  total: number;
  /** Tax grouped by rate, ascending. Empty when no line carries a tax rate. */
  groups: TaxGroup[];
}

/**
 * Full invoice tax math: per-line `taxRate` → subtotal, tax grouped by rate,
 * grand total. Lines without a tax rate contribute no tax, so legacy
 * invoices (no tax rates) keep total === subtotal exactly.
 */
export function invoiceTaxTotals(items: InvoiceLineItem[]): InvoiceTaxTotals {
  const subtotal = sumLineItems(items);
  const byRate = new Map<
    number,
    { taxable: number; tax: number; label: string | undefined; mixed: boolean }
  >();
  for (const line of items) {
    const rate = line.taxRate ?? 0;
    if (!rate) continue;
    const entry = byRate.get(rate) ?? {
      taxable: 0,
      tax: 0,
      label: line.taxLabel,
      mixed: false,
    };
    entry.taxable = round2(entry.taxable + line.amount);
    entry.tax = round2(entry.tax + lineItemTaxAmount(line));
    if (entry.label !== line.taxLabel) {
      entry.mixed = true;
      entry.label = undefined;
    }
    byRate.set(rate, entry);
  }
  const groups: TaxGroup[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, entry]) => ({
      rate,
      label: !entry.mixed && entry.label ? entry.label : null,
      taxable: entry.taxable,
      tax: entry.tax,
    }));
  const taxTotal = round2(groups.reduce((sum, g) => sum + g.tax, 0));
  return { subtotal, taxTotal, total: round2(subtotal + taxTotal), groups };
}

// ---------------------------------------------------------------------------
// Region behavior (US-first; EU explicitly separated)
// ---------------------------------------------------------------------------

/** "Sales tax" for US, "VAT" for EU. */
export function taxLabelForRegion(region: TaxRegion | undefined): string {
  return region === "EU" ? "VAT" : "Sales tax";
}

/** "Tax ID" for US, "VAT ID" for EU — caller may override with a custom label. */
export function defaultTaxIdLabelForRegion(
  region: TaxRegion | undefined,
): string {
  return region === "EU" ? "VAT ID" : "Tax ID";
}

/** US invoices print on Letter; EU invoices on A4. */
export function pageSizeForRegion(
  region: TaxRegion | undefined,
): "LETTER" | "A4" {
  return region === "EU" ? "A4" : "LETTER";
}

/** Default currency when neither the invoice nor settings name one. */
export function defaultCurrencyForRegion(
  region: TaxRegion | undefined,
): string {
  return region === "EU" ? "EUR" : "USD";
}

/** Effective tax region: invoice override → settings default → US. */
export function resolveInvoiceTaxRegion(
  invoice: Pick<Invoice, "taxRegion">,
  settingsDefault?: TaxRegion,
): TaxRegion {
  return invoice.taxRegion ?? settingsDefault ?? "US";
}

/** Effective currency: invoice → settings default → region default. */
export function resolveInvoiceCurrency(
  invoice: Pick<Invoice, "currency" | "taxRegion">,
  settingsDefault?: string,
): string {
  const code = invoice.currency ?? settingsDefault;
  if (code) return code.toUpperCase();
  return defaultCurrencyForRegion(invoice.taxRegion);
}

/** Effective seller tax-ID label: invoice override → settings → region default. */
export function resolveSellerTaxIdLabel(
  invoice: Pick<Invoice, "sellerTaxIdLabel" | "taxRegion">,
  settingsLabel?: string,
): string {
  return (
    invoice.sellerTaxIdLabel ??
    settingsLabel ??
    defaultTaxIdLabelForRegion(invoice.taxRegion)
  );
}

// ---------------------------------------------------------------------------
// Amount in words (English; structured so other languages can plug in)
// ---------------------------------------------------------------------------

/** Major/minor unit names used to spell out an amount, per currency. */
export interface AmountWordUnits {
  majorSingular: string;
  majorPlural: string;
  minorSingular: string;
  minorPlural: string;
}

const WORD_UNITS: Record<string, AmountWordUnits> = {
  USD: {
    majorSingular: "dollar",
    majorPlural: "dollars",
    minorSingular: "cent",
    minorPlural: "cents",
  },
  EUR: {
    majorSingular: "euro",
    majorPlural: "euros",
    minorSingular: "cent",
    minorPlural: "cents",
  },
  GBP: {
    majorSingular: "pound",
    majorPlural: "pounds",
    minorSingular: "penny",
    minorPlural: "pence",
  },
  CHF: {
    majorSingular: "franc",
    majorPlural: "francs",
    minorSingular: "centime",
    minorPlural: "centimes",
  },
  JPY: {
    majorSingular: "yen",
    majorPlural: "yen",
    minorSingular: "sen",
    minorPlural: "sen",
  },
  CAD: {
    majorSingular: "dollar",
    majorPlural: "dollars",
    minorSingular: "cent",
    minorPlural: "cents",
  },
  AUD: {
    majorSingular: "dollar",
    majorPlural: "dollars",
    minorSingular: "cent",
    minorPlural: "cents",
  },
  INR: {
    majorSingular: "rupee",
    majorPlural: "rupees",
    minorSingular: "paisa",
    minorPlural: "paise",
  },
};

const ONES_EN = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS_EN = [
  "", "", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety",
];
const SCALES_EN = ["", "thousand", "million", "billion", "trillion"];

function threeDigitsEn(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES_EN[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES_EN[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS_EN[tens]}-${ONES_EN[ones]}` : TENS_EN[tens]);
    }
  }
  return parts.join(" ");
}

/** English words for a non-negative integer (up to 999 trillion). */
export function numberToWordsEn(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error("numberToWordsEn needs a non-negative finite number");
  const int = Math.floor(n);
  if (int === 0) return "zero";
  const chunks: string[] = [];
  let remaining = int;
  let scale = 0;
  while (remaining > 0 && scale < SCALES_EN.length) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const words = threeDigitsEn(chunk);
      chunks.unshift(SCALES_EN[scale] ? `${words} ${SCALES_EN[scale]}` : words);
    }
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }
  return chunks.join(" ");
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Spell out a money amount in English, e.g.
 * `amountInWords(1234.56)` → "One thousand two hundred thirty-four dollars and fifty-six cents".
 * Unknown currencies fall back to the ISO code as the unit name.
 */
export function amountInWords(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount)) throw new Error("amountInWords needs a finite amount");
  const code = currency.toUpperCase();
  const units = WORD_UNITS[code] ?? {
    majorSingular: code,
    majorPlural: code,
    minorSingular: "cent",
    minorPlural: "cents",
  };
  const totalCents = Math.round(amount * 100);
  const negative = totalCents < 0;
  const absCents = Math.abs(totalCents);
  const major = Math.floor(absCents / 100);
  const minor = absCents % 100;
  const parts: string[] = [];
  if (major > 0 || minor === 0) {
    parts.push(
      `${numberToWordsEn(major)} ${major === 1 ? units.majorSingular : units.majorPlural}`,
    );
  }
  if (minor > 0) {
    parts.push(
      `${numberToWordsEn(minor)} ${minor === 1 ? units.minorSingular : units.minorPlural}`,
    );
  }
  const sentence = parts.join(" and ");
  return capitalizeFirst(negative ? `negative ${sentence}` : sentence);
}

// ---------------------------------------------------------------------------
// Payment QR payloads
// ---------------------------------------------------------------------------

export interface EpcQrInput {
  /** Beneficiary (seller) name, max 70 chars. */
  beneficiaryName: string;
  /** IBAN, no spaces. */
  iban: string;
  /** BIC/SWIFT, 8 or 11 chars (may be empty for some domestic transfers). */
  bic?: string;
  /** Amount in EUR. */
  amountEur: number;
  /** Remittance reference / invoice number, max 140 chars. */
  remittance?: string;
}

function epcField(value: string, max: number): string {
  return value.replace(/[\r\n]/g, " ").trim().slice(0, max);
}

/**
 * Build an EPC069-12 SEPA credit-transfer QR payload (the "EPC QR code"
 * used across the EU for bank-transfer invoices). Plain-text standard —
 * implemented here from the public EPC spec, no external dependency.
 */
export function buildEpcQrPayload(input: EpcQrInput): string {
  const amount = input.amountEur;
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000_000) {
    throw new Error("EPC QR amount must be > 0 and < 1,000,000,000");
  }
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    throw new Error("EPC QR needs a valid IBAN");
  }
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    epcField(input.bic ?? "", 11).toUpperCase(),
    epcField(input.beneficiaryName, 70),
    iban,
    `EUR${amount.toFixed(2)}`,
    "",
    epcField(input.remittance ?? "", 140),
    "",
  ];
  return lines.join("\n");
}

export interface InvoiceQrContext {
  businessName: string;
}

/**
 * Decide what goes into the invoice QR code:
 * 1. explicit `qrPayload` override wins;
 * 2. EU invoices with an IBAN get an EPC/SEPA credit-transfer payload;
 * 3. otherwise the payment URL, if set;
 * 4. last resort: a compact human-readable payment reference.
 * Returns null when QR is disabled.
 */
export function resolveInvoiceQrPayload(
  invoice: Invoice,
  ctx: InvoiceQrContext,
): string | null {
  if (!invoice.qrEnabled) return null;
  const explicit = invoice.qrPayload?.trim();
  if (explicit) return explicit;
  const currency = (invoice.currency ?? "USD").toUpperCase();
  const region = invoice.taxRegion ?? "US";
  if (region === "EU" && invoice.bankAccount && currency === "EUR") {
    try {
      return buildEpcQrPayload({
        beneficiaryName: ctx.businessName,
        iban: invoice.bankAccount,
        bic: invoice.swiftBic,
        amountEur: invoice.total,
        remittance: invoice.invoiceNumber,
      });
    } catch {
      // Fall through to the generic payloads below.
    }
  }
  const url = invoice.paymentUrl?.trim();
  if (url) return url;
  return `Invoice ${invoice.invoiceNumber}: ${currency} ${invoice.total.toFixed(2)}`;
}

/**
 * Build invoice line items from unbilled work: tasks become hour-based lines
 * (rate = project override → client default), expenses become cost lines.
 * Pure — the caller decides which tasks/expenses are in scope.
 */
export function buildUnbilledLineItems(
  tasks: Task[],
  expenses: Expense[],
  projectsById: Map<string, Project>,
  clientsById: Map<string, Client>,
): InvoiceLineItem[] {
  const lineItems: InvoiceLineItem[] = [];
  for (const t of tasks) {
    const project = projectsById.get(t.projectId);
    const client = project ? clientsById.get(project.clientId) : undefined;
    lineItems.push(taskToLineItem(t, project, client));
  }
  for (const e of expenses) {
    lineItems.push(expenseToLineItem(e));
  }
  return lineItems;
}
