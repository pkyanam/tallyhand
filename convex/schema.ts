/**
 * Convex schema for hosted mode (`TALLY_STORAGE=convex`).
 *
 * Mirrors the Postgres schema (`src/lib/db/postgres-schema.ts`): every
 * table carries `userId`, and all functions in `tally.ts` scope by it.
 * Deploy with `convex dev` / `npx convex deploy` after the coordinator
 * installs the `convex` package; set CONVEX_URL to the deployment URL.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const timestamps = {
  createdAt: v.number(),
  updatedAt: v.number(),
};

export default defineSchema({
  extensionEntities: defineTable({
    userId: v.string(), id: v.string(),
    kind: v.union(v.literal("mileage"), v.literal("contract"), v.literal("taxPayment"), v.literal("rateCard")),
    data: v.any(), updatedAt: v.number(),
  }).index("by_owner_kind", ["userId", "kind"])
    .index("by_owner_kind_id", ["userId", "kind", "id"]),
  workspaceRevisions: defineTable({
    userId: v.string(),
    revision: v.number(),
  }).index("by_user", ["userId"]),
  requestReceipts: defineTable({
    key: v.string(), fingerprint: v.string(), claimId: v.string(),
    state: v.union(v.literal("pending"), v.literal("complete")),
    createdAt: v.number(), status: v.optional(v.number()), body: v.optional(v.string()),
    contentType: v.optional(v.string()),
  }).index("by_key", ["key"]),
  clients: defineTable({
    id: v.string(),
    userId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    defaultRate: v.optional(v.number()),
    notes: v.optional(v.string()),
    archived: v.boolean(),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"]),

  projects: defineTable({
    id: v.string(),
    userId: v.string(),
    clientId: v.string(),
    name: v.string(),
    rateOverride: v.optional(v.number()),
    archived: v.boolean(),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"])
    .index("by_user_client", ["userId", "clientId"]),

  tasks: defineTable({
    id: v.string(),
    userId: v.string(),
    projectId: v.string(),
    name: v.string(),
    startAt: v.number(),
    endAt: v.number(),
    durationMinutes: v.number(),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
    isBilled: v.boolean(),
    invoiceId: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"])
    .index("by_user_project", ["userId", "projectId"]),

  expenses: defineTable({
    id: v.string(),
    userId: v.string(),
    clientId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    date: v.number(),
    amount: v.number(),
    category: v.string(),
    note: v.optional(v.string()),
    receiptB64: v.optional(v.string()),
    receiptKey: v.optional(v.string()),
    isBilled: v.boolean(),
    invoiceId: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"]),

  invoices: defineTable({
    id: v.string(),
    userId: v.string(),
    clientId: v.string(),
    invoiceNumber: v.string(),
    issueDate: v.number(),
    dueDate: v.number(),
    status: v.string(),
    lineItems: v.any(),
    subtotal: v.number(),
    total: v.number(),
    notes: v.optional(v.string()),
    publicToken: v.optional(v.string()),
    // invoice localization / payment (all optional; absent = legacy)
    currency: v.optional(v.string()),
    taxRegion: v.optional(v.string()),
    sellerTaxId: v.optional(v.string()),
    sellerTaxIdLabel: v.optional(v.string()),
    buyerTaxId: v.optional(v.string()),
    sellerEmailVisible: v.optional(v.boolean()),
    buyerEmailVisible: v.optional(v.boolean()),
    serviceStart: v.optional(v.number()),
    serviceEnd: v.optional(v.number()),
    invoiceType: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    paymentUrl: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    swiftBic: v.optional(v.string()),
    qrEnabled: v.optional(v.boolean()),
    qrPayload: v.optional(v.string()),
    qrDescription: v.optional(v.string()),
    amountInWords: v.optional(v.boolean()),
    template: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"])
    .index("by_user_publicToken", ["userId", "publicToken"]),

  /** One document per user; `userId` is the lookup key. */
  settings: defineTable({
    userId: v.string(),
    data: v.any(),
  }).index("by_user", ["userId"]),

  recurringSchedules: defineTable({
    id: v.string(),
    userId: v.string(),
    clientId: v.string(),
    projectId: v.optional(v.string()),
    name: v.string(),
    mode: v.string(),
    frequency: v.string(),
    interval: v.number(),
    lineItems: v.any(),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    maxOccurrences: v.optional(v.number()),
    nextRunAt: v.number(),
    lastRunAt: v.optional(v.number()),
    occurrences: v.number(),
    status: v.string(),
    notes: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"])
    .index("by_user_client", ["userId", "clientId"]),

  retainers: defineTable({
    id: v.string(),
    userId: v.string(),
    clientId: v.string(),
    name: v.string(),
    type: v.string(),
    totalHours: v.optional(v.number()),
    amountCents: v.number(),
    hourlyRate: v.optional(v.number()),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    status: v.string(),
    recurringScheduleId: v.optional(v.string()),
    notes: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_user_id", ["userId", "id"])
    .index("by_user_client", ["userId", "clientId"]),

  shareLinks: defineTable({
    id: v.string(),
    userId: v.string(),
    type: v.string(),
    target: v.any(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    ...timestamps,
  })
    .index("by_user", ["userId"])
    .index("by_link_id", ["id"]),

  timesheetApprovals: defineTable({
    id: v.string(),
    userId: v.string(),
    shareLinkId: v.string(),
    clientId: v.string(),
    weekStartMs: v.number(),
    approvedAt: v.number(),
    approverName: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_link", ["userId", "shareLinkId"]),

  apiTokens: defineTable({
    id: v.string(),
    userId: v.string(),
    name: v.string(),
    /** SHA-256 hex of the raw token — the raw value is never stored. */
    tokenHash: v.string(),
    /** First 8 chars of the raw token, for display only. */
    prefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_hash", ["tokenHash"]),
});
