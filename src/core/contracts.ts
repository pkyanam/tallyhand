/**
 * Contracts — the contract vault. SOWs, MSAs, NDAs and other agreements
 * linked to clients/projects, with renewal/expiry awareness.
 *
 * Pure: status math and reminder selection only. Persistence lives in the
 * storage layer; surfacing lives in the UI / API.
 */
import type { ID, Timestamped } from "./entities";

export type ContractType = "sow" | "msa" | "nda" | "other";

export interface Contract extends Timestamped {
  id: ID;
  clientId: ID;
  projectId?: ID;
  type: ContractType;
  title: string;
  /** ms epoch. */
  startDate: number;
  /** ms epoch. Omitted = open-ended (e.g. evergreen MSA). */
  endDate?: number;
  /** Days before endDate to start warning. Defaults to 30. */
  renewalNoticeDays: number;
  autoRenew?: boolean;
  /** Optional stored file (base64 data URL), like expense receipts. */
  fileB64?: string;
  fileName?: string;
  notes?: string;
  archived: boolean;
}

export type ContractCreateInput = Omit<
  Contract,
  "id" | "createdAt" | "updatedAt" | "archived" | "renewalNoticeDays"
> & { id?: ID; archived?: boolean; renewalNoticeDays?: number };

export type ContractStatus = "upcoming" | "active" | "expiring" | "expired";

export interface ContractStatusInfo {
  status: ContractStatus;
  /** Whole days until endDate (negative when expired); null when open-ended. */
  daysUntilExpiry: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from nowMs until endDate (negative = past). */
function daysUntil(endDate: number, nowMs: number): number {
  return Math.floor((endDate - nowMs) / MS_PER_DAY);
}

/**
 * Status of one contract at a point in time.
 * - upcoming: startDate is in the future
 * - expiring: endDate within renewalNoticeDays (and not yet expired)
 * - expired: endDate has passed
 * - active: otherwise
 */
export function contractStatus(
  contract: Contract,
  nowMs: number,
): ContractStatusInfo {
  if (contract.startDate > nowMs) {
    const daysUntilExpiry =
      contract.endDate != null ? daysUntil(contract.endDate, nowMs) : null;
    return { status: "upcoming", daysUntilExpiry };
  }
  if (contract.endDate == null) {
    return { status: "active", daysUntilExpiry: null };
  }
  const d = daysUntil(contract.endDate, nowMs);
  if (d < 0) return { status: "expired", daysUntilExpiry: d };
  const noticeDays =
    Number.isFinite(contract.renewalNoticeDays) && contract.renewalNoticeDays >= 0
      ? contract.renewalNoticeDays
      : 30;
  if (d <= noticeDays) return { status: "expiring", daysUntilExpiry: d };
  return { status: "active", daysUntilExpiry: d };
}

/**
 * True when a single contract needs renewal attention: expiring soon or
 * already expired, excluding archived ones.
 */
export function needsRenewalAttention(
  contract: Contract,
  nowMs: number,
): boolean {
  if (contract.archived) return false;
  const { status } = contractStatus(contract, nowMs);
  return status === "expiring" || status === "expired";
}

/**
 * Contracts that need attention: expiring soon or already expired,
 * excluding archived ones. Sorted by urgency (most overdue first).
 */
export function contractsNeedingAttention(
  contracts: Contract[],
  nowMs: number,
): Array<{ contract: Contract; info: ContractStatusInfo }> {
  return contracts
    .filter((c) => !c.archived)
    .map((contract) => ({ contract, info: contractStatus(contract, nowMs) }))
    .filter(
      ({ info }) => info.status === "expiring" || info.status === "expired",
    )
    .sort(
      (a, b) =>
        (a.info.daysUntilExpiry ?? Number.POSITIVE_INFINITY) -
        (b.info.daysUntilExpiry ?? Number.POSITIVE_INFINITY),
    );
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  sow: "Statement of work",
  msa: "Master services agreement",
  nda: "Non-disclosure agreement",
  other: "Other",
};
