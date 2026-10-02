/**
 * Postgres schema for hosted mode (Drizzle ORM).
 *
 * SERVER ONLY — imports drizzle-orm/pg-core (installed by the coordinator;
 * see the track manifest). Never import from client components.
 *
 * Every entity table carries `user_id`: per-user data isolation is enforced
 * by the provider, which scopes EVERY query with `user_id = <session user>`.
 * Migrations live in `drizzle/` and are applied with `drizzle-kit migrate`.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Tallyhand entities — one row per user, always scoped by user_id
// ---------------------------------------------------------------------------

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    address: text("address"),
    defaultRate: doublePrecision("default_rate"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("clients_user_id_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    rateOverride: doublePrecision("rate_override"),
    archived: boolean("archived").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("projects_user_id_idx").on(t.userId),
    index("projects_user_client_idx").on(t.userId, t.clientId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    startAt: bigint("start_at", { mode: "number" }).notNull(),
    endAt: bigint("end_at", { mode: "number" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isBilled: boolean("is_billed").notNull().default(false),
    invoiceId: text("invoice_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("tasks_user_id_idx").on(t.userId),
    index("tasks_user_project_idx").on(t.userId, t.projectId),
    index("tasks_user_start_idx").on(t.userId, t.startAt),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id"),
    projectId: text("project_id"),
    date: bigint("date", { mode: "number" }).notNull(),
    amount: doublePrecision("amount").notNull(),
    category: text("category").notNull(),
    note: text("note"),
    receiptB64: text("receipt_b64"),
    /** Attachment-store key for the receipt (hosted/S3 path; receiptB64 is legacy inline). */
    receiptKey: text("receipt_key"),
    isBilled: boolean("is_billed").notNull().default(false),
    invoiceId: text("invoice_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("expenses_user_id_idx").on(t.userId),
    index("expenses_user_date_idx").on(t.userId, t.date),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: bigint("issue_date", { mode: "number" }).notNull(),
    dueDate: bigint("due_date", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    lineItems: jsonb("line_items").notNull().default([]),
    subtotal: doublePrecision("subtotal").notNull(),
    total: doublePrecision("total").notNull(),
    notes: text("notes"),
    publicToken: text("public_token"),
    cloudLinkEnabled: boolean("cloud_link_enabled"),
    // -- invoice localization / payment (all nullable; absent = legacy) --
    currency: text("currency"),
    taxRegion: text("tax_region"),
    sellerTaxId: text("seller_tax_id"),
    sellerTaxIdLabel: text("seller_tax_id_label"),
    buyerTaxId: text("buyer_tax_id"),
    sellerEmailVisible: boolean("seller_email_visible"),
    buyerEmailVisible: boolean("buyer_email_visible"),
    serviceStart: bigint("service_start", { mode: "number" }),
    serviceEnd: bigint("service_end", { mode: "number" }),
    invoiceType: text("invoice_type"),
    paymentMethod: text("payment_method"),
    paymentUrl: text("payment_url"),
    bankAccount: text("bank_account"),
    swiftBic: text("swift_bic"),
    qrEnabled: boolean("qr_enabled"),
    qrPayload: text("qr_payload"),
    qrDescription: text("qr_description"),
    amountInWords: boolean("amount_in_words"),
    template: text("template"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("invoices_user_id_idx").on(t.userId),
    index("invoices_public_token_idx").on(t.publicToken),
  ],
);

export const recurringSchedules = pgTable(
  "recurring_schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    projectId: text("project_id"),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    frequency: text("frequency").notNull(),
    interval: integer("interval").notNull(),
    lineItems: jsonb("line_items").notNull().default([]),
    startDate: bigint("start_date", { mode: "number" }).notNull(),
    endDate: bigint("end_date", { mode: "number" }),
    maxOccurrences: integer("max_occurrences"),
    nextRunAt: bigint("next_run_at", { mode: "number" }).notNull(),
    lastRunAt: bigint("last_run_at", { mode: "number" }),
    occurrences: integer("occurrences").notNull().default(0),
    status: text("status").notNull(),
    notes: text("notes"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("recurring_schedules_user_id_idx").on(t.userId),
    index("recurring_schedules_user_client_idx").on(t.userId, t.clientId),
  ],
);

export const retainers = pgTable(
  "retainers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    totalHours: doublePrecision("total_hours"),
    amountCents: integer("amount_cents").notNull(),
    hourlyRate: doublePrecision("hourly_rate"),
    startDate: bigint("start_date", { mode: "number" }).notNull(),
    endDate: bigint("end_date", { mode: "number" }),
    status: text("status").notNull(),
    recurringScheduleId: text("recurring_schedule_id"),
    notes: text("notes"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("retainers_user_id_idx").on(t.userId),
    index("retainers_user_client_idx").on(t.userId, t.clientId),
  ],
);

/** One settings row per user; user_id is the primary key. */
export const settings = pgTable("settings", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull(),
});

// ---------------------------------------------------------------------------
// Sharing (hosted only)
// ---------------------------------------------------------------------------

export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** invoice | timesheet | estimate */
    type: text("type").notNull(),
    /**
     * Type-specific target:
     * - invoice:   { invoiceId }
     * - timesheet: { clientId, weekStartMs }
     * - estimate:  { clientId, title?, lineItems[], notes? } (snapshot)
     */
    target: jsonb("target").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("share_links_user_id_idx").on(t.userId)],
);

export const timesheetApprovals = pgTable(
  "timesheet_approvals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    shareLinkId: text("share_link_id").notNull(),
    clientId: text("client_id").notNull(),
    weekStartMs: bigint("week_start_ms", { mode: "number" }).notNull(),
    approvedAt: bigint("approved_at", { mode: "number" }).notNull(),
    approverName: text("approver_name"),
    note: text("note"),
  },
  (t) => [
    index("timesheet_approvals_user_id_idx").on(t.userId),
    index("timesheet_approvals_link_idx").on(t.shareLinkId),
    // One approval per (user, link, week): makes concurrent public
    // approvals race-safe — the loser gets a 23505 unique violation.
    uniqueIndex("timesheet_approvals_dedup_uidx").on(
      t.userId,
      t.shareLinkId,
      t.weekStartMs,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Builtin auth (TALLY_AUTH=builtin): magic-link users + one-time tokens
// ---------------------------------------------------------------------------

export const builtinUsers = pgTable(
  "builtin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: text("role").notNull().default("member"),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
);

export const builtinLoginTokens = pgTable(
  "builtin_login_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => builtinUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("builtin_login_tokens_user_id_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// End-to-end encrypted sync vault (hosted only: postgres + neon)
// ---------------------------------------------------------------------------

/**
 * One encrypted entity snapshot per (user, entity type, entity id). The
 * server stores only ciphertext: `iv` and `ciphertext` are base64 AES-GCM
 * output produced client-side with a per-user data key that never leaves
 * the device. `updated_at` is client-supplied and drives last-write-wins;
 * `deleted` marks a tombstone so other devices learn a deletion.
 */
export const encryptedEntities = pgTable(
  "encrypted_entities",
  {
    userId: text("user_id").notNull(),
    /** e.g. "client" | "project" | "task" | "expense" | "invoice" | "setting" | … */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** base64 96-bit AES-GCM IV */
    iv: text("iv").notNull(),
    /** base64 AES-GCM ciphertext of the entity JSON */
    ciphertext: text("ciphertext").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityType, t.entityId] }),
    index("encrypted_entities_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);
