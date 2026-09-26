import type { Expense, Invoice, Task } from "@/core/entities";

/** Static metadata every plugin ships. */
export interface PluginManifest {
  /** Unique machine name, e.g. "stripe-payments". */
  name: string;
  /** Semver string, e.g. "0.1.0". */
  version: string;
  /** One-line human description shown in the plugin list. */
  description: string;
  /**
   * Optional npm peer dependencies, e.g. `{ stripe: "22.6.2" }`.
   * Documented only — Tallyhand never auto-installs them.
   */
  peerDependencies?: Record<string, string>;
}

/** Payload for the onPaymentReceived hook. */
export interface PaymentReceivedPayload {
  invoice: Invoice;
  /** Amount actually collected, in minor currency units. */
  amountCents: number;
  /** Payment provider name, e.g. "stripe". */
  provider: string;
  /** Provider-side id (Stripe Checkout Session id). */
  externalId: string;
}

/** Payload per domain hook, keyed by hook name. */
export interface DomainHookPayloads {
  onTaskCreated: Task;
  onTaskUpdated: Task;
  onExpenseCreated: Expense;
  onInvoiceSent: Invoice;
  onInvoicePaid: Invoice;
  /** Fired when an invoice is first observed overdue by the dunning run. */
  onInvoiceOverdue: Invoice;
  /** Fired when money is collected against an invoice (webhook, etc.). */
  onPaymentReceived: PaymentReceivedPayload;
}

export type DomainHookName = keyof DomainHookPayloads;

export type DomainHookHandler<K extends DomainHookName> = (
  payload: DomainHookPayloads[K],
) => void | Promise<void>;

/** What plugins use to observe domain events. */
export interface HookRegistrar {
  /**
   * Subscribe to a domain hook. Returns an unsubscribe function.
   * Handlers run after the domain operation commits; a throwing handler
   * is logged and never breaks the operation.
   */
  on<K extends DomainHookName>(
    name: K,
    handler: DomainHookHandler<K>,
  ): () => void;
}

/** A UI extension point: `{ slot: "dashboard.widget", id, component, order }`. */
export interface SlotDefinition {
  /** Slot id, e.g. "dashboard.widget", "ledger.row-action", "settings.section", "command-palette.action". */
  slot: string;
  /** Unique within the slot (convention: `${pluginName}.${name}`). */
  id: string;
  /** Rendered entry. Kept as `unknown` so plugins aren't forced onto React. */
  component: unknown;
  /** Lower renders first. Defaults to 0. */
  order?: number;
}

export interface UIRegistry {
  registerSlot(def: SlotDefinition): () => void;
  getSlots(slot: string): SlotDefinition[];
}

export interface PluginSettingsField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  defaultValue: string | number | boolean;
  options?: string[];
  description?: string;
}

export interface PluginSettingsSection {
  /** Unique section id (convention: `${pluginName}.settings`). */
  id: string;
  title: string;
  description?: string;
  fields: PluginSettingsField[];
}

/** Plugins declare their own settings UI; the host persists values. */
export interface SettingsRegistry {
  registerSection(section: PluginSettingsSection): () => void;
  getSections(): PluginSettingsSection[];
}

export interface BackgroundJob {
  /** Unique job id (convention: `${pluginName}.${name}`). */
  id: string;
  run: () => void | Promise<void>;
  /** Re-run cadence. Omitted = run once at activation. */
  intervalMs?: number;
}

/** Plugins schedule background work (reminders, sync, polling). */
export interface JobRegistry {
  registerJob(job: BackgroundJob): () => void;
  getJobs(): BackgroundJob[];
}

/** What a plugin receives on activation. */
export interface PluginContext {
  manifest: PluginManifest;
  hooks: HookRegistrar;
  ui: UIRegistry;
  settings: SettingsRegistry;
  jobs: JobRegistry;
}

/** A Tallyhand plugin. */
export interface Plugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
