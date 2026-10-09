import type { FinancialScope, PageQuery } from "@/core/financial";
import { resolveFinancialRequestAuthority, authorizeFinancial } from "@/server/financial-authority";
import { getFinancialStore } from "@/server/financial-store";
import { getStripeConnectionMeta } from "@/lib/stripe-connect/store";
import { resolveCheckoutStripeKey, getConnectAccount } from "@/server/stripe-connect";
import { json } from "@/server/http";
import { requireSyncHeader } from "../_lib/sync-auth";
import { getFinancialGrant } from "@/lib/financial/grants";

export function financialPage(req: Request): PageQuery {
  const query = new URL(req.url).searchParams;
  const raw = query.get("limit") ?? "50";
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    throw Object.assign(new Error("limit must be an integer from 1 to 100"), { status: 400 });
  }
  const cursor = query.get("cursor") ?? undefined;
  if (cursor && cursor.length > 2048) throw Object.assign(new Error("Invalid cursor"), { status: 400 });
  return { limit: Number(raw), cursor };
}

export async function financialContext(req: Request, action: "read" | "reconcile") {
  const identity = await resolveFinancialRequestAuthority(req);
  if (action !== "read" && identity.authority.kind === "owner") {
    const error = requireSyncHeader(req);
    if (error) return error;
  }
  const workspace = { userId: identity.userId, workspaceId: identity.userId };
  if (action === "read" && identity.authority.kind === "owner") {
    // Owner reads are workspace history, including disconnected accounts and
    // manual evidence. This scope is authorization-only and is never persisted.
    const scope: FinancialScope = { ...workspace, provider: "stripe", accountId: "", mode: "test" };
    await authorizeFinancial(action, identity.authority, scope);
    return { workspace, scope, authority: identity.authority, store: await getFinancialStore(identity.userId) };
  }
  if (identity.authority.kind === "api-token" || identity.authority.kind === "oauth") {
    const grant = await getFinancialGrant(identity.userId, identity.authority.grantId);
    if (!grant) throw Object.assign(new Error("Financial authority denied"), { status: 403 });
    const scope: FinancialScope = { ...workspace, provider: "stripe", accountId: grant.accountId, mode: grant.mode };
    await authorizeFinancial(action, identity.authority, scope);
    return { workspace, scope, authority: identity.authority, store: await getFinancialStore(identity.userId) };
  }
  const connection = await getStripeConnectionMeta(identity.userId);
  let accountId = connection?.accountId;
  let mode: "test" | "live" = connection?.livemode ? "live" : "test";
  if (!accountId) {
    const resolved = await resolveCheckoutStripeKey(identity.userId);
    accountId = resolved.stripeAccount ?? (await getConnectAccount(resolved.secretKey)).id;
    mode = resolved.mode as "test" | "live";
  }
  const scope: FinancialScope = { ...workspace, provider: "stripe", accountId, mode };
  await authorizeFinancial(action, identity.authority, scope);
  return { workspace, scope, authority: identity.authority, store: await getFinancialStore(identity.userId) };
}

export function financialError(error: unknown): Response {
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 503;
  const safeStatus = [400, 401, 403, 404].includes(status) ? status : 503;
  const code = safeStatus === 400 ? "bad_request" : safeStatus === 401 ? "unauthorized" : safeStatus === 403 ? "forbidden" : "financial_unavailable";
  return json({ error: { code, message: safeStatus === 400 && error instanceof Error ? error.message : safeStatus === 403 ? "Financial authority denied" : "Financial records unavailable" } }, safeStatus);
}
