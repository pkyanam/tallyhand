/**
 * Signed share-link service (hosted feature).
 *
 * - `createShareLink`: authenticated owner creates a link for an invoice,
 *   timesheet (client + week), or estimate snapshot. Returns the HMAC token
 *   and public URL. Target ids are validated against the OWNER's data before
 *   the link is created (an owner can't share someone else's invoice).
 * - `resolveShareToken`: public capability resolution for /share/[token].
 *   Verifies the HMAC signature, DB expiry, type match, and revocation,
 *   then loads the shared payload scoped to the link OWNER (never the
 *   anonymous visitor).
 * - `approveTimesheet`: public timesheet approval with anti-abuse guards
 *   (one approval per link+week; expired/revoked links rejected).
 *
 * Secrets: TALLY_SHARE_SECRET (min 32 chars) — rotation invalidates all
 * outstanding links; document accordingly.
 */
import { z } from "zod";
import {
  signShareToken,
  verifyShareToken,
  type ShareLinkType,
} from "@/core/share";
import type { Client, Invoice, Project, Task, Settings } from "@/core/entities";
import type {
  HostedStorageProvider,
  ShareLinkCreateInput,
  ShareLinkRow,
  TimesheetApprovalRow,
} from "@/lib/db/hosted-types";

export const SHARE_TYPES = ["invoice", "timesheet", "estimate"] as const;

const expiresInDays = z
  .number()
  .int()
  .min(1)
  .max(365)
  .default(30)
  .describe("Days until expiry, 1–365");

/** Discriminated union: `type` determines the exact target shape. */
export const CreateShareSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("invoice"),
    target: z.object({
      invoiceId: z.string().min(1),
      // Client-supplied snapshot (invoice + client + display settings).
      // Used when the owner's data lives client-side (local-first browser)
      // rather than in the server's tables: the browser holds the data and
      // sends a point-in-time snapshot for the public page. Sharing is an
      // explicit user action, so the snapshot is theirs to publish.
      snapshot: z
        .object({
          invoice: z.record(z.string(), z.unknown()),
          client: z.record(z.string(), z.unknown()).nullable(),
        })
        .optional(),
    }),
    expiresInDays,
  }),
  z.object({
    type: z.literal("timesheet"),
    target: z.object({ clientId: z.string().min(1), weekStartMs: z.number().int() }),
    expiresInDays,
  }),
  z.object({
    type: z.literal("estimate"),
    target: z.object({ snapshot: z.record(z.string(), z.unknown()) }),
    expiresInDays,
  }),
]);
export type CreateShareInput = z.infer<typeof CreateShareSchema>;

export interface CreatedShare {
  link: ShareLinkRow;
  token: string;
  url: string;
}

export interface ShareDeps {
  /** Provider scoped to the authenticated owner (share creation). */
  ownerProvider: HostedStorageProvider;
  /** Build a provider scoped to an arbitrary user id (share resolution). */
  providerForUser: (userId: string) => HostedStorageProvider;
  shareSecret: string;
  baseUrl: string;
}

export function shareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/share/${token}`;
}

/** Authenticated: create a signed share link for the owner's own data. */
export async function createShareLink(
  deps: ShareDeps,
  raw: unknown,
): Promise<CreatedShare> {
  const input = CreateShareSchema.parse(raw);
  const { ownerProvider, shareSecret, baseUrl } = deps;

  // Validate the target exists in the OWNER's data (prevents cross-user
  // sharing and dangling links). The discriminated union already narrows
  // `type` ↔ `target` here. Invoice shares may instead carry a
  // client-supplied snapshot (local-first browser data); the snapshot is
  // validated for shape and the invoiceId must match it.
  if (input.type === "invoice") {
    const current = await ownerProvider.getInvoice(input.target.invoiceId);
    if (current?.cloudLinkEnabled === false) throw new Error("Cloud sharing is disabled for this invoice");
    const snap = input.target.snapshot;
    if (snap) {
      const snapInvoice = snap.invoice as { id?: unknown };
      if (snapInvoice.id !== input.target.invoiceId) {
        throw new Error("Snapshot invoice id mismatch");
      }
    } else {
      const invoice = await ownerProvider.getInvoice(input.target.invoiceId);
      if (!invoice) throw new Error("Invoice not found");
    }
  } else if (input.type === "timesheet") {
    const client = await ownerProvider.getClient(input.target.clientId);
    if (!client) throw new Error("Client not found");
  }

  const expiresAt = Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000;
  const createInput: ShareLinkCreateInput = {
    type: input.type,
    target: input.target,
    expiresAt,
  };
  // Providers assign their own ids internally; embed the assigned id in the
  // signed token after creation.
  const link = await ownerProvider.createShareLink(createInput);
  const linkId = link.id;
  const token = signShareToken(
    { v: 1, lid: linkId, typ: input.type, exp: expiresAt },
    shareSecret,
  );
  return { link, token, url: shareUrl(baseUrl, token) };
}

/** Estimate snapshot rendered on the public portal (typed loosely: JSON snapshot). */
export interface EstimateSnapshot {
  title?: string;
  clientName?: string;
  validUntil?: number;
  notes?: string;
  total?: number;
  lineItems?: Array<Record<string, unknown>>;
}

export interface ResolvedShare {
  link: ShareLinkRow;
  invoice?: Invoice & { client: Client | null };
  settings?: Settings;
  timesheet?: {
    client: Client | null;
    weekStartMs: number;
    projects: Project[];
    tasks: Task[];
    totals: { minutes: number; amount: number };
    approved: boolean;
  };
  estimate?: EstimateSnapshot;
}

/** Public: resolve a share token to its payload (after HMAC verification). */
export async function resolveShareToken(
  deps: ShareDeps,
  token: string,
  expectedType?: ShareLinkType,
): Promise<ResolvedShare> {
  const payload = verifyShareToken(token, deps.shareSecret);
  if (!payload) throw Object.assign(new Error("Invalid or expired share link"), { status: 404 });
  if (expectedType && payload.typ !== expectedType) {
    throw Object.assign(new Error("Share link type mismatch"), { status: 404 });
  }

  const unscoped = deps.ownerProvider;
  const link = await unscoped.getShareLinkById(payload.lid);
  if (!link) throw Object.assign(new Error("Share link not found"), { status: 404 });
  if (link.revokedAt != null) throw Object.assign(new Error("Share link revoked"), { status: 410 });
  if (link.expiresAt <= Date.now()) throw Object.assign(new Error("Share link expired"), { status: 410 });
  if (link.type !== payload.typ) throw Object.assign(new Error("Share link mismatch"), { status: 404 });

  // All target data is loaded through a provider scoped to the LINK OWNER.
  const owner = deps.providerForUser(link.userId);
  const target = link.target as Record<string, unknown>;

  if (link.type === "invoice" && typeof target.invoiceId === "string") {
    const current = await owner.getInvoice(target.invoiceId);
    if (current?.cloudLinkEnabled === false) throw Object.assign(new Error("Invoice sharing disabled"), { status: 410 });
    // Snapshot shares (local-first browser data): the public page renders
    // the client-supplied snapshot — no server-side invoice needed.
    const snap = target.snapshot as
      | { invoice?: unknown; client?: unknown }
      | undefined;
    if (snap?.invoice && typeof snap.invoice === "object") {
      return {
        link,
        invoice: {
          ...(snap.invoice as Invoice),
          client: (snap.client as Client | null) ?? null,
        },
      };
    }
    const invoice = await owner.getInvoice(target.invoiceId);
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
    const client = await owner.getClient(invoice.clientId);
    return { link, invoice: { ...invoice, client: client ?? null }, settings: await owner.getSettings() };
  }

  if (
    link.type === "timesheet" &&
    typeof target.clientId === "string" &&
    typeof target.weekStartMs === "number"
  ) {
    const client = await owner.getClient(target.clientId);
    if (!client) throw Object.assign(new Error("Client not found"), { status: 404 });
    const weekStart = target.weekStartMs;
    const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
    const projects = await owner.listProjectsByClient(target.clientId);
    const projectIds = new Set(projects.map((p) => p.id));
    const allTasks = await owner.listTasks();
    const tasks = allTasks.filter(
      (t) => projectIds.has(t.projectId) && t.startAt >= weekStart && t.startAt < weekEnd,
    );
    const minutes = tasks.reduce((s, t) => s + t.durationMinutes, 0);
    const rateByProject = new Map(projects.map((p) => [p.id, p.rateOverride ?? client.defaultRate ?? 0]));
    const amount = tasks.reduce(
      (s, t) => s + (t.durationMinutes / 60) * (rateByProject.get(t.projectId) ?? 0),
      0,
    );
    const approvals = await owner.listTimesheetApprovalsByLink(link.id);
    const approved = approvals.some((a) => a.weekStartMs === weekStart);
    return {
      link,
      timesheet: { client: client ?? null, weekStartMs: weekStart, projects, tasks, totals: { minutes, amount }, approved },
    };
  }

  if (link.type === "estimate") {
    return { link, estimate: ((target as { snapshot?: unknown }).snapshot ?? target) as EstimateSnapshot };
  }

  throw Object.assign(new Error("Unsupported share link"), { status: 404 });
}

/** Public: approve a timesheet week via its share link (one per link+week). */
export async function approveTimesheet(
  deps: ShareDeps,
  token: string,
  input: { approverName?: string; note?: string },
): Promise<TimesheetApprovalRow> {
  const resolved = await resolveShareToken(deps, token, "timesheet");
  if (!resolved.timesheet) throw Object.assign(new Error("Not a timesheet link"), { status: 404 });
  if (resolved.timesheet.approved) {
    throw Object.assign(new Error("This week has already been approved"), { status: 409 });
  }
  const owner = deps.providerForUser(resolved.link.userId);
  return owner.recordTimesheetApproval({
    shareLinkId: resolved.link.id,
    clientId: resolved.timesheet.client?.id ?? "",
    weekStartMs: resolved.timesheet.weekStartMs,
    approverName: input.approverName?.slice(0, 120),
    note: input.note?.slice(0, 1000),
  });
}

export function shareSecretFromEnv(): string {
  const secret = process.env.TALLY_SHARE_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("TALLY_SHARE_SECRET (min 32 chars) is required for share links");
  }
  return secret;
}
