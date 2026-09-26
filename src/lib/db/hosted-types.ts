/**
 * Shared hosted-provider types (Postgres + Convex).
 *
 * Kept in a dependency-free module so the Convex provider never imports the
 * Postgres provider (whose schema module requires drizzle-orm).
 */
import type { ShareLinkType } from "@/core/share";
import type { StorageProvider } from "@/core/storage";

/**
 * Hosted storage surface: the base StorageProvider plus share-link and
 * timesheet-approval methods, implemented by the Postgres and Convex
 * providers. The local (Dexie/SQLite) providers do not implement these.
 */
export interface HostedStorageProvider extends StorageProvider {
  createShareLink(input: ShareLinkCreateInput): Promise<ShareLinkRow>;
  getShareLinkById(id: string): Promise<ShareLinkRow | undefined>;
  listShareLinks(): Promise<ShareLinkRow[]>;
  revokeShareLink(id: string): Promise<void>;
  listTimesheetApprovalsByLink(linkId: string): Promise<TimesheetApprovalRow[]>;
  recordTimesheetApproval(input: TimesheetApprovalInput): Promise<TimesheetApprovalRow>;
}

/** Owner id: fixed string, or a lazy async resolver (request-scoped auth). */
export type UserIdSource = string | (() => Promise<string>);

export interface ShareLinkRow {
  id: string;
  userId: string;
  type: ShareLinkType;
  target: unknown;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

export interface ShareLinkCreateInput {
  type: ShareLinkType;
  target: unknown;
  expiresAt: number;
}

export interface TimesheetApprovalRow {
  id: string;
  userId: string;
  shareLinkId: string;
  clientId: string;
  weekStartMs: number;
  approvedAt: number;
  approverName?: string;
  note?: string;
}

export interface TimesheetApprovalInput {
  shareLinkId: string;
  clientId: string;
  weekStartMs: number;
  approverName?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Dynamic-row plumbing (Postgres + Convex providers)
// ---------------------------------------------------------------------------

/**
 * Rows from dynamically-loaded backends arrive as unknown. DbRow is the
 * honest shape: a string-keyed record narrowed field-by-field in provider
 * mappers (no `any` anywhere).
 */
export type DbRow = Record<string, unknown>;

export const dbStr = (r: DbRow, k: string): string => r[k] as string;
export const dbOptStr = (r: DbRow, k: string): string | undefined =>
  (r[k] as string | null | undefined) ?? undefined;
export const dbNum = (r: DbRow, k: string): number => r[k] as number;
export const dbOptNum = (r: DbRow, k: string): number | undefined =>
  (r[k] as number | null | undefined) ?? undefined;
export const dbStrArr = (r: DbRow, k: string): string[] =>
  Array.isArray(r[k]) ? (r[k] as string[]) : [];
export const dbJsonArr = (r: DbRow, k: string): unknown[] =>
  Array.isArray(r[k]) ? (r[k] as unknown[]) : [];
