/**
 * Dunning engine — pure domain logic for overdue-invoice follow-up.
 *
 * Given a set of invoices and a DunningConfig, `computeDunningActions`
 * decides which payment reminders are due (per a configurable schedule of
 * days-past-due, e.g. [7, 14, 30]) and which late fees should be applied
 * automatically per the invoice's payment terms.
 *
 * No I/O, no storage, no network: callers (the API route, the CLI, tests)
 * persist the returned actions and deliver the rendered reminders.
 */
import type { ID, Invoice, InvoiceLineItem } from "./entities";
import { newId } from "./id";

export const MS_PER_DAY = 86_400_000;

/** Round dollars to whole cents. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LateFeePolicy {
  enabled: boolean;
  /**
   * "flat" = fixed dollar amount per application;
   * "percent" = percent of the invoice total per application.
   */
  type: "flat" | "percent";
  /** Dollars when "flat"; percentage points (e.g. 1.5 = 1.5%) when "percent". */
  amount: number;
  /** Days past due before a fee may be applied. */
  graceDays: number;
  /**
   * "once" applies the fee a single time (first crossing of graceDays);
   * "monthly" re-applies every 30 days past the grace threshold.
   */
  recurring: "once" | "monthly";
  /** Cap on cumulative late fees per invoice, in dollars. Omit = no cap. */
  maxTotal?: number;
}

export interface DunningConfig {
  enabled: boolean;
  /** Days past due at which reminders go out, e.g. [7, 14, 30]. */
  reminderDays: number[];
  /** Escalate subject/body tone as the reminder stage increases. */
  escalatingTone: boolean;
  lateFee: LateFeePolicy;
}

export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  enabled: true,
  reminderDays: [7, 14, 30],
  escalatingTone: true,
  lateFee: {
    enabled: false,
    type: "percent",
    amount: 1.5,
    graceDays: 30,
    recurring: "monthly",
  },
};

export interface DunningReminder {
  invoiceId: ID;
  invoiceNumber: string;
  /** Which schedule day triggered this reminder. */
  reminderDay: number;
  /** 0-based index into the (sorted) reminderDays schedule. */
  stage: number;
  daysOverdue: number;
  amountDue: number;
  subject: string;
  body: string;
}

export interface LateFeeApplication {
  invoiceId: ID;
  amount: number;
  description: string;
}

export interface DunningActions {
  reminders: DunningReminder[];
  lateFees: LateFeeApplication[];
  /**
   * Invoices that crossed into overdue with no reminder history yet —
   * the host should emit `onInvoiceOverdue` for these.
   */
  newlyOverdue: Invoice[];
}

/** Whole days between two ms timestamps (floored, never negative). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / MS_PER_DAY));
}

/** Is this invoice currently overdue? Only "sent" invoices can be overdue. */
export function isOverdue(invoice: Invoice, nowMs: number): boolean {
  return invoice.status === "sent" && invoice.dueDate < nowMs;
}

/**
 * Compute the late-fee amount for one application against an invoice.
 * Returns 0 when the policy is disabled, the grace period hasn't elapsed,
 * or the cap is already exhausted.
 */
export function computeLateFeeAmount(
  invoice: Invoice,
  policy: LateFeePolicy,
  nowMs: number,
): number {
  if (!policy.enabled) return 0;
  if (policy.amount <= 0) return 0;
  const daysOverdue = daysBetween(invoice.dueDate, nowMs);
  if (daysOverdue < policy.graceDays) return 0;

  const applied = invoice.lateFeeApplications ?? [];
  if (policy.recurring === "once" && applied.length > 0) return 0;
  if (policy.recurring === "monthly") {
    // One application per 30-day window past the grace threshold.
    const windowsElapsed =
      Math.floor((daysOverdue - policy.graceDays) / 30) + 1;
    if (applied.length >= windowsElapsed) return 0;
  }

  const raw =
    policy.type === "flat"
      ? policy.amount
      : round2((invoice.total * policy.amount) / 100);
  if (raw <= 0) return 0;

  const totalSoFar = applied.reduce((sum, a) => sum + a.amount, 0);
  if (policy.maxTotal != null) {
    const remaining = round2(policy.maxTotal - totalSoFar);
    if (remaining <= 0) return 0;
    return Math.min(raw, remaining);
  }
  return raw;
}

/**
 * Purely apply a late fee to an invoice: appends a "manual" line item,
 * bumps subtotal/total, and records the application. The caller persists
 * the returned invoice.
 */
export function applyLateFeeToInvoice(
  invoice: Invoice,
  application: LateFeeApplication,
  nowMs: number,
): Invoice {
  const lineItem: InvoiceLineItem = {
    id: newId("li"),
    description: application.description,
    quantity: 1,
    rate: application.amount,
    amount: application.amount,
    sourceType: "manual",
  };
  return {
    ...invoice,
    lineItems: [...invoice.lineItems, lineItem],
    subtotal: round2(invoice.subtotal + application.amount),
    total: round2(invoice.total + application.amount),
    lateFeeApplications: [
      ...(invoice.lateFeeApplications ?? []),
      { appliedAt: nowMs, amount: application.amount },
    ],
    updatedAt: nowMs,
  };
}

const TONES: Array<{
  subject: (name: string, num: string, days: number) => string;
  body: (name: string, num: string, amount: string, days: number) => string;
}> = [
  {
    subject: (_n, num) => `Friendly reminder: invoice ${num} is due`,
    body: (name, num, amount, days) =>
      `Hi ${name},\n\nJust a friendly nudge — invoice ${num} for ${amount} was due ${days} day${days === 1 ? "" : "s"} ago. If you've already paid, please ignore this note.\n\nThanks!`,
  },
  {
    subject: (_n, num) => `Payment overdue: invoice ${num}`,
    body: (name, num, amount, days) =>
      `Hi ${name},\n\nInvoice ${num} for ${amount} is now ${days} days overdue. Please arrange payment at your earliest convenience, or reply if there's an issue we should know about.\n\nThanks,`,
  },
  {
    subject: (_n, num, days) => `Final notice: invoice ${num} (${days} days overdue)`,
    body: (name, num, amount, days) =>
      `Hi ${name},\n\nThis is a final notice: invoice ${num} for ${amount} is ${days} days overdue. Please remit payment immediately to avoid further action, including late fees where applicable.\n\nRegards,`,
  },
];

/**
 * Render a reminder for a stage. When `escalatingTone` is false every
 * stage uses the friendly first template.
 */
export function renderReminder(args: {
  clientName: string;
  invoiceNumber: string;
  amountDue: number;
  daysOverdue: number;
  stage: number;
  escalatingTone: boolean;
}): { subject: string; body: string } {
  const toneIndex = args.escalatingTone
    ? Math.min(args.stage, TONES.length - 1)
    : 0;
  const tone = TONES[toneIndex];
  const amount = `$${args.amountDue.toFixed(2)}`;
  return {
    subject: tone.subject(args.clientName, args.invoiceNumber, args.daysOverdue),
    body: tone.body(
      args.clientName,
      args.invoiceNumber,
      amount,
      args.daysOverdue,
    ),
  };
}

export interface DunningClientInfo {
  id: ID;
  name: string;
}

/**
 * Compute every dunning action due right now.
 *
 * - Reminders: for each overdue invoice, every schedule day at or below
 *   `daysOverdue` that has no matching entry in `invoice.reminderLog`.
 * - Late fees: via `computeLateFeeAmount`.
 * - Newly overdue: overdue invoices with an empty reminder log.
 */
export function computeDunningActions(
  invoices: Invoice[],
  clientsById: Map<ID, DunningClientInfo>,
  config: DunningConfig,
  nowMs: number,
): DunningActions {
  const reminders: DunningReminder[] = [];
  const lateFees: LateFeeApplication[] = [];
  const newlyOverdue: Invoice[] = [];

  if (!config.enabled) {
    return { reminders, lateFees, newlyOverdue };
  }

  const schedule = [...config.reminderDays]
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  for (const invoice of invoices) {
    if (!isOverdue(invoice, nowMs)) continue;
    const daysOverdue = daysBetween(invoice.dueDate, nowMs);
    const log = invoice.reminderLog ?? [];
    const sentDays = new Set(log.map((r) => r.reminderDay));

    if (log.length === 0 && invoice.overdueNotifiedAt == null)
      newlyOverdue.push(invoice);

    schedule.forEach((day, stage) => {
      if (daysOverdue >= day && !sentDays.has(day)) {
        const client = clientsById.get(invoice.clientId);
        const rendered = renderReminder({
          clientName: client?.name ?? "there",
          invoiceNumber: invoice.invoiceNumber,
          amountDue: invoice.total,
          daysOverdue,
          stage,
          escalatingTone: config.escalatingTone,
        });
        reminders.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          reminderDay: day,
          stage,
          daysOverdue,
          amountDue: invoice.total,
          subject: rendered.subject,
          body: rendered.body,
        });
      }
    });

    const feeAmount = computeLateFeeAmount(invoice, config.lateFee, nowMs);
    if (feeAmount > 0) {
      const basis =
        config.lateFee.type === "flat"
          ? `$${config.lateFee.amount.toFixed(2)}`
          : `${config.lateFee.amount}%`;
      lateFees.push({
        invoiceId: invoice.id,
        amount: feeAmount,
        description: `Late fee (${basis}, ${daysOverdue} days overdue)`,
      });
    }
  }

  return { reminders, lateFees, newlyOverdue };
}
