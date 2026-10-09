import { money, type Money } from "./money";
import type { FinancialScope, FinancialActor } from "./types";

export type FinancialAction = "collect" | "read" | "reconcile";
export type FinancialPrincipal =
  | { kind: "api-token"; tokenId: string }
  | { kind: "oauth"; userId: string; clientId: string };
export interface FinancialGrant {
  id: string;
  userId: string;
  workspaceId: string;
  principal: FinancialPrincipal;
  actions: FinancialAction[];
  accountId: string;
  mode: "test" | "live";
  currency: Money["currency"];
  maxMinorUnits: number;
  createdAt: number;
  revokedAt: number | null;
}
export interface FinancialGrantProof {
  grantId: string;
  principal: FinancialPrincipal;
  action: FinancialAction;
  scope: FinancialScope;
  money?: Money;
  invoiceId?: string;
  grantedAt: number;
}
function samePrincipal(a: FinancialPrincipal, b: FinancialPrincipal): boolean {
  return a.kind === "api-token"
    ? b.kind === "api-token" && a.tokenId === b.tokenId
    : b.kind === "oauth" && a.userId === b.userId && a.clientId === b.clientId;
}
export function assertFinancialGrant(
  grant: FinancialGrant | null,
  proof: FinancialGrantProof,
): void {
  if (
    !grant ||
    grant.revokedAt !== null ||
    grant.id !== proof.grantId ||
    grant.createdAt !== proof.grantedAt ||
    grant.userId !== proof.scope.userId ||
    grant.workspaceId !== proof.scope.workspaceId ||
    grant.accountId !== proof.scope.accountId ||
    grant.mode !== proof.scope.mode ||
    proof.scope.provider !== "stripe" ||
    !grant.actions.includes(proof.action) ||
    !samePrincipal(grant.principal, proof.principal)
  )
    throw Object.assign(new Error("Financial authority denied"), {
      status: 403,
    });
  if (proof.action === "collect" && !proof.money)
    throw Object.assign(new Error("Collection amount required"), {
      status: 403,
    });
  if (proof.money) {
    money(proof.money.minorUnits, proof.money.currency);
    if (
      proof.money.currency !== grant.currency ||
      proof.money.minorUnits > grant.maxMinorUnits
    )
      throw Object.assign(new Error("Financial limit exceeded"), {
        status: 403,
      });
  }
}

/** A verified share capability reference, never its bearer secret. */
export interface FinancialCapabilityProof {
  kind: "customer";
  linkId: string;
  userId: string;
  workspaceId: string;
  invoiceId: string;
  expiresAt: number;
}
export function assertFinancialCapability(
  link: {
    id: string;
    userId: string;
    type: string;
    target: unknown;
    expiresAt: number;
    revokedAt?: number | null;
  } | null,
  proof: FinancialCapabilityProof | undefined,
  scope: FinancialScope,
  invoiceId: string,
  now: number,
): void {
  const target = link?.target as { invoiceId?: string } | undefined;
  if (
    !proof ||
    !link ||
    proof.kind !== "customer" ||
    link.id !== proof.linkId ||
    link.userId !== scope.userId ||
    proof.userId !== scope.userId ||
    proof.workspaceId !== scope.workspaceId ||
    link.type !== "invoice" ||
    link.revokedAt != null ||
    link.expiresAt <= now ||
    link.expiresAt !== proof.expiresAt ||
    target?.invoiceId !== invoiceId ||
    proof.invoiceId !== invoiceId
  )
    throw Object.assign(new Error("Financial capability denied"), {
      status: 403,
    });
}

/** Validate the current dispatcher, independently of who prepared the intent. */
export function assertFinancialDispatchActor(
  actor: FinancialActor | undefined,
  scope: FinancialScope,
  grant?: FinancialGrantProof,
  capability?: FinancialCapabilityProof,
): void {
  if (!actor || !actor.id || actor.kind === "system")
    throw Object.assign(new Error("Current financial dispatcher required"), {
      status: 403,
    });
  if (actor.kind === "owner") {
    if (actor.id !== scope.userId)
      throw Object.assign(new Error("Financial owner mismatch"), {
        status: 403,
      });
  } else if (actor.kind === "agent") {
    const principalId =
      grant?.principal.kind === "api-token"
        ? grant.principal.tokenId
        : grant?.principal.clientId;
    if (!grant || actor.id !== principalId)
      throw Object.assign(
        new Error("Current machine financial authority required"),
        { status: 403 },
      );
  } else if (actor.kind === "customer") {
    if (
      !capability ||
      actor.id !== capability.linkId ||
      capability.userId !== scope.userId ||
      capability.workspaceId !== scope.workspaceId
    )
      throw Object.assign(
        new Error("Current customer financial capability required"),
        { status: 403 },
      );
  } else
    throw Object.assign(new Error("Unknown financial dispatcher"), {
      status: 403,
    });
}
