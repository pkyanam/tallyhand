/** Financial execution authority is independent of broad workspace permissions. */
import type { FinancialCapabilityProof } from "@/core/financial/authority";
import type { FinancialActor, FinancialScope } from "@/core/financial/types";
import {
  assertSameMoney,
  legacyTotalToMoney,
  type Money,
} from "@/core/financial/money";
import {
  assertFinancialGrant,
  getFinancialGrant,
  type FinancialAction,
  type FinancialGrantProof,
} from "@/lib/financial/grants";
import { findApiTokenUncached } from "@/lib/auth/api-tokens";
import { isOAuthToken, verifyTallyOAuthUncached } from "@/lib/auth/oauth";
import { requireSessionUserId } from "@/lib/auth/session";
import { effectiveAuth } from "@/lib/mode";
import { getUserRole } from "@/lib/auth/users";
import { resolveShareToken } from "@/lib/share/service";
import { getShareDeps } from "@/lib/share/server-deps";
export type FinancialAuthority =
  | { kind: "owner"; userId: string }
  | { kind: "api-token"; token: string; grantId: string }
  | { kind: "oauth"; token: string; grantId: string }
  | { kind: "customer"; shareToken: string };
function denied(): never {
  throw Object.assign(new Error("Financial authority denied"), { status: 403 });
}
export async function resolveFinancialRequestAuthority(
  req: Request,
): Promise<{ userId: string; authority: FinancialAuthority }> {
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin && origin !== new URL(req.url).origin)
    denied();
  const raw = /^Bearer (.+)$/.exec(
    (req.headers.get("authorization") ?? "").trim(),
  )?.[1];
  if (raw) {
    const grantId = req.headers.get("X-Tally-Financial-Grant");
    if (!grantId) denied();
    if (isOAuthToken(raw)) {
      const identity = await verifyTallyOAuthUncached(raw);
      if (!identity) denied();
      return {
        userId: identity.userId,
        authority: { kind: "oauth", token: raw, grantId },
      };
    }
    const identity = await findApiTokenUncached(raw);
    if (!identity) denied();
    return {
      userId: identity.userId,
      authority: { kind: "api-token", token: raw, grantId },
    };
  }
  const userId =
    effectiveAuth() === "none" ? "local" : await requireSessionUserId();
  return { userId, authority: { kind: "owner", userId } };
}
export async function authorizeFinancial(
  action: FinancialAction,
  authority: FinancialAuthority,
  scope: FinancialScope,
  resource?: { invoiceId: string; money: Money },
): Promise<{
  actor: FinancialActor;
  proof?: FinancialGrantProof;
  capabilityProof?: FinancialCapabilityProof;
}> {
  if (scope.workspaceId !== scope.userId || scope.provider !== "stripe")
    denied();
  if (authority.kind === "owner") {
    const current =
      effectiveAuth() === "none" ? "local" : await requireSessionUserId();
    if (current !== authority.userId || current !== scope.userId) denied();
    if (
      action !== "read" &&
      effectiveAuth() !== "none" &&
      (await getUserRole(current)) === "viewer"
    )
      denied();
    return { actor: { kind: "owner", id: current } };
  }
  if (authority.kind === "customer") {
    if (action !== "collect" || !resource) denied();
    const resolved = await resolveShareToken(
      getShareDeps(),
      authority.shareToken,
      "invoice",
    );
    if (
      resolved.link.userId !== scope.userId ||
      !resolved.invoice ||
      resolved.invoice.id !== resource.invoiceId ||
      resolved.invoice.status !== "sent"
    )
      denied();
    assertSameMoney(
      legacyTotalToMoney(
        resolved.invoice.total,
        resolved.invoice.currency ?? "USD",
      ),
      resource.money,
    );
    return {
      actor: { kind: "customer", id: resolved.link.id },
      capabilityProof: {
        kind: "customer",
        linkId: resolved.link.id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        invoiceId: resource.invoiceId,
        expiresAt: resolved.link.expiresAt,
      },
    };
  }
  const identity =
    authority.kind === "api-token"
      ? await findApiTokenUncached(authority.token)
      : await verifyTallyOAuthUncached(authority.token);
  if (!identity || identity.userId !== scope.userId) denied();
  const principal =
    authority.kind === "api-token"
      ? { kind: "api-token" as const, tokenId: (identity as { id: string }).id }
      : {
          kind: "oauth" as const,
          userId: identity.userId,
          clientId: (identity as { clientId: string }).clientId,
        };
  const grant = await getFinancialGrant(scope.userId, authority.grantId);
  const proof: FinancialGrantProof = {
    grantId: authority.grantId,
    principal,
    action,
    scope,
    ...(resource
      ? { money: resource.money, invoiceId: resource.invoiceId }
      : {}),
    grantedAt: grant?.createdAt ?? 0,
  };
  assertFinancialGrant(grant, proof);
  if (
    effectiveAuth() !== "none" &&
    action !== "read" &&
    (await getUserRole(scope.userId)) === "viewer"
  )
    denied();
  return {
    actor: {
      kind: "agent",
      id:
        principal.kind === "api-token" ? principal.tokenId : principal.clientId,
    },
    proof,
  };
}
