/**
 * Robust `tallyhand.v1` bundle import: detection → field migration →
 * zod validation → import into the current (v2) stores.
 *
 * Why this exists: `parseTallyhandBundleV1` in `src/lib/app-bundle.ts`
 * does a blind `as unknown as TallyhandBundleV1` cast — a hand-edited or
 * older export with a missing `tags` array, a missing `archived` flag, or
 * an invoice without `status` would import corrupt rows (or crash Dexie on
 * a missing `id`). This module:
 *
 * 1. DETECTS the payload: `tallyhand.v1` bundles are accepted;
 *    `tallyhand.ledger.v1` (the ledger JSON export) and anything else get
 *    a clear error telling the user what they actually picked.
 * 2. MIGRATES known legacy field shapes (defaults for fields that older
 *    exports didn't write — see `migrate*` below; inferred from the export
 *    history in git, where entity shapes have been stable but optional
 *    sections/arrays were added over time).
 * 3. VALIDATES every entity with zod, collecting per-entity errors
 *    (`clients[3].name: expected string`) instead of failing on the first
 *    row or, worse, importing garbage.
 * 4. Returns a clean `TallyhandBundleV1` for the existing
 *    `importTallyhandBundleV1()` — the actual store write is unchanged.
 *
 * Unknown extra fields pass through (`.passthrough()`): a bundle exported
 * by a NEWER app still imports into this one, keeping its extra fields.
 */
import { z } from "zod";
import {
  TALLYHAND_BUNDLE_FORMAT,
  type TallyhandBundleV1,
} from "./app-bundle";

export type DetectedFormat =
  | "tallyhand.v1"
  | "tallyhand.ledger.v1"
  | "unknown";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Identify what the user actually picked. Never throws. */
export function detectBundleFormat(raw: unknown): DetectedFormat {
  if (!isRecord(raw)) return "unknown";
  if (raw.format === TALLYHAND_BUNDLE_FORMAT) return "tallyhand.v1";
  if (raw.format === "tallyhand.ledger.v1") return "tallyhand.ledger.v1";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Field migration (legacy shapes → current shapes)
// ---------------------------------------------------------------------------

/**
 * Fill defaults for fields older exports didn't write. Every rule here is
 * additive and conservative: it only fills in MISSING values, never rewrites
 * present ones.
 */
function migrateTimestamps(
  e: Record<string, unknown>,
): Record<string, unknown> {
  if (e.createdAt === undefined) e.createdAt = 0;
  if (e.updatedAt === undefined) e.updatedAt = 0;
  return e;
}

function migrateClient(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const e = { ...raw };
  if (e.archived === undefined) e.archived = false;
  return migrateTimestamps(e);
}

function migrateProject(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const e = { ...raw };
  if (e.archived === undefined) e.archived = false;
  return migrateTimestamps(e);
}

function migrateTask(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const e = { ...raw };
  if (e.tags === undefined) e.tags = [];
  if (e.isBilled === undefined) e.isBilled = false;
  return migrateTimestamps(e);
}

function migrateExpense(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const e = { ...raw };
  if (e.isBilled === undefined) e.isBilled = false;
  return migrateTimestamps(e);
}

const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;

function migrateInvoice(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const e = { ...raw };
  if (!INVOICE_STATUSES.includes(e.status as (typeof INVOICE_STATUSES)[number])) {
    e.status = "draft";
  }
  if (!Array.isArray(e.lineItems)) e.lineItems = [];
  // Very old exports sometimes omitted the computed totals: recompute from
  // the (migrated) line items so the invoice isn't a NaN bomb.
  const items = e.lineItems as Record<string, unknown>[];
  const sum = items.reduce(
    (acc, li) =>
      acc + (typeof li.amount === "number" && Number.isFinite(li.amount) ? li.amount : 0),
    0,
  );
  if (typeof e.subtotal !== "number") e.subtotal = sum;
  if (typeof e.total !== "number") e.total = sum;
  return migrateTimestamps(e);
}

/** Optional entity arrays added after the first exports: absent = empty. */
const OPTIONAL_ARRAYS = [
  "recurringSchedules",
  "retainers",
  "mileageEntries",
  "contracts",
  "taxPayments",
  "rateCards",
] as const;

function migrateBundle(raw: Record<string, unknown>): Record<string, unknown> {
  const b = { ...raw };
  const asArr = (v: unknown) => (Array.isArray(v) ? v : []);
  b.clients = asArr(b.clients).map(migrateClient);
  b.projects = asArr(b.projects).map(migrateProject);
  b.tasks = asArr(b.tasks).map(migrateTask);
  b.expenses = asArr(b.expenses).map(migrateExpense);
  b.invoices = asArr(b.invoices).map(migrateInvoice);
  for (const k of OPTIONAL_ARRAYS) {
    if (b[k] === undefined) b[k] = [];
  }
  return b;
}

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1, "id is required");
const tsSchema = z.number();

const clientSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    email: z.string().optional(),
    address: z.string().optional(),
    defaultRate: z.number().optional(),
    notes: z.string().optional(),
    archived: z.boolean(),
    createdAt: tsSchema,
    updatedAt: tsSchema,
  })
  .passthrough();

const projectSchema = z
  .object({
    id: idSchema,
    clientId: z.string(),
    name: z.string(),
    rateOverride: z.number().optional(),
    archived: z.boolean(),
    createdAt: tsSchema,
    updatedAt: tsSchema,
  })
  .passthrough();

const taskSchema = z
  .object({
    id: idSchema,
    projectId: z.string(),
    name: z.string(),
    startAt: z.number(),
    endAt: z.number(),
    durationMinutes: z.number(),
    notes: z.string().optional(),
    tags: z.array(z.string()),
    isBilled: z.boolean(),
    invoiceId: z.string().optional(),
    createdAt: tsSchema,
    updatedAt: tsSchema,
  })
  .passthrough();

const expenseSchema = z
  .object({
    id: idSchema,
    clientId: z.string().optional(),
    projectId: z.string().optional(),
    date: z.number(),
    amount: z.number(),
    category: z.string(),
    note: z.string().optional(),
    receiptB64: z.string().optional(),
    receiptKey: z.string().optional(),
    isBilled: z.boolean(),
    invoiceId: z.string().optional(),
    createdAt: tsSchema,
    updatedAt: tsSchema,
  })
  .passthrough();

const lineItemSchema = z
  .object({
    id: idSchema,
    description: z.string(),
    quantity: z.number(),
    rate: z.number(),
    amount: z.number(),
    markupPercent: z.number().optional(),
    sourceType: z.enum(["task", "expense", "manual"]).optional(),
    sourceId: z.string().optional(),
    taxRate: z.number().optional(),
    taxLabel: z.string().optional(),
  })
  .passthrough();

const invoiceSchema = z
  .object({
    id: idSchema,
    clientId: z.string(),
    invoiceNumber: z.string(),
    issueDate: z.number(),
    dueDate: z.number(),
    status: z.enum(INVOICE_STATUSES),
    lineItems: z.array(lineItemSchema),
    subtotal: z.number(),
    total: z.number(),
    notes: z.string().optional(),
    publicToken: z.string().optional(),
    createdAt: tsSchema,
    updatedAt: tsSchema,
  })
  .passthrough();

/** Track-2/3 entities: validated loosely — unknown future fields pass through. */
const looseEntitySchema = z
  .object({ id: idSchema, createdAt: tsSchema, updatedAt: tsSchema })
  .passthrough();

const bundleSchema = z.object({
  format: z.literal(TALLYHAND_BUNDLE_FORMAT),
  exportedAt: z.string(),
  settings: z.record(z.string(), z.unknown()),
  clients: z.array(clientSchema),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  expenses: z.array(expenseSchema),
  invoices: z.array(invoiceSchema),
  recurringSchedules: z.array(looseEntitySchema).optional(),
  retainers: z.array(looseEntitySchema).optional(),
  mileageEntries: z.array(looseEntitySchema).optional(),
  contracts: z.array(looseEntitySchema).optional(),
  taxPayments: z.array(looseEntitySchema).optional(),
  rateCards: z.array(looseEntitySchema).optional(),
});

export interface ValidatedBundle {
  bundle: TallyhandBundleV1;
  /** How many fields the migration filled in (for the "imported with N fixes" notice). */
  migratedFields: number;
}

function countMigratedFields(before: unknown, after: unknown): number {
  // Shallow structural diff: count keys present in `after` but not `before`,
  // recursing into the known entity arrays.
  if (!isRecord(before) || !isRecord(after)) return 0;
  let n = 0;
  for (const k of Object.keys(after)) {
    if (!(k in before)) {
      n++;
      continue;
    }
    const b = before[k];
    const a = after[k];
    if (Array.isArray(b) && Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) {
        n += countMigratedFields(b[i], a[i]);
      }
    } else if (isRecord(b) && isRecord(a)) {
      n += countMigratedFields(b, a);
    }
  }
  return n;
}

/**
 * Detect → migrate → validate. Returns a clean `TallyhandBundleV1` ready
 * for `importTallyhandBundleV1()`. Throws an `Error` with a human-readable
 * message (suitable for `showNotice`) on any problem.
 */
export function parseAndValidateBundle(raw: unknown): ValidatedBundle {
  const format = detectBundleFormat(raw);
  if (format === "tallyhand.ledger.v1") {
    throw new Error(
      "That's a ledger export (tallyhand.ledger.v1), not a backup bundle — it holds ledger rows, not your full database. Import needs the “Export bundle (JSON)” file (tallyhand.v1).",
    );
  }
  if (format !== "tallyhand.v1") {
    throw new Error(
      `Not a Tallyhand backup: expected format "tallyhand.v1", got ${isRecord(raw) ? JSON.stringify(raw.format) ?? "none" : "a non-object"}.`,
    );
  }
  const migrated = migrateBundle(raw as Record<string, unknown>);
  const parsed = bundleSchema.safeParse(migrated);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 5).map((i) => {
      const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
      return `${path}${i.message}`;
    });
    const more =
      parsed.error.issues.length > 5
        ? ` (+${parsed.error.issues.length - 5} more)`
        : "";
    throw new Error(`Backup validation failed — ${first.join("; ")}${more}`);
  }
  const migratedFields = countMigratedFields(raw, migrated);
  return {
    bundle: {
      ...parsed.data,
      settings: parsed.data.settings as unknown as TallyhandBundleV1["settings"],
    } as TallyhandBundleV1,
    migratedFields,
  };
}
