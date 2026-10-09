/** Server-only scheduled recovery. This worker never dispatches financial commands. */
import { createHash } from "node:crypto";
import { getFinancialStore } from "./financial-store";
import {
  discoverFinancialScopes,
  claimFinancialRecoveryRun,
  finishFinancialRecoveryRun,
  getFinancialScopeRecoveryCheckpoint,
  saveFinancialScopeRecoveryCheckpoint,
} from "./financial-maintenance";
import { recoverFinancialWork } from "./financial-recovery";
import { drainFinancialNotifications } from "./financial-notifications";
import type { FinancialScope } from "@/core/financial/types";

export interface FinancialRecoveryCursors {
  workCursor?: string;
  paymentCursor?: string;
  providerCursors?: Record<string, string>;
}
export interface FinancialRecoveryCheckpoint {
  scopeOffset?: number;
  scopeCursor?: string;
  scopes: Record<string, FinancialRecoveryCursors>;
}
const key = (scope: FinancialScope) =>
  createHash("sha256").update(JSON.stringify(scope)).digest("hex");
export async function runFinancialRecoveryBatch(limit = 20) {
  const boundedLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const startedAt = Date.now();
  const run = await claimFinancialRecoveryRun();
  if (!run)
    return {
      examined: 0,
      backlog: true,
      skipped: "already_running",
      results: [],
    };
  const checkpoint = run.state;
  const page = await discoverFinancialScopes({
    limit: boundedLimit,
    cursor: checkpoint.scopeCursor,
  });
  const results: Array<{
    scope: FinancialScope;
    status: "recovered" | "retry";
    backlog?: boolean;
    code?: string;
  }> = [];
  let examined = 0;
  const offset = checkpoint.scopeOffset ?? 0;
  for (const scope of page.items.slice(offset)) {
    if (Date.now() - startedAt > 45_000) break;
    examined++;
    const scopeKey = key(scope);
    try {
      const store = await getFinancialStore(scope.userId);
      const scopeProgress = await getFinancialScopeRecoveryCheckpoint(scopeKey);
      // Give durable notifications a turn even when provider reconciliation
      // exhausts this run's budget. Newly produced messages can wait for the next run.
      await drainFinancialNotifications(
        store,
        scope,
        Math.min(startedAt + 45_000, Date.now() + 25_000),
      );
      const recovered = await recoverFinancialWork(store, scope, 20, {
        ...scopeProgress,
        deadline: startedAt + 45_000,
      });
      const incomplete = Boolean(
        recovered.nextCursor ||
        recovered.paymentCursor ||
        Object.keys(recovered.providerCursors).length,
      );
      await saveFinancialScopeRecoveryCheckpoint(
        run.token,
        scopeKey,
        incomplete
          ? {
              workCursor: recovered.nextCursor,
              paymentCursor: recovered.paymentCursor,
              providerCursors: recovered.providerCursors,
            }
          : null,
      );
      results.push({
        scope,
        status: recovered.retryCount ? "retry" : "recovered",
        ...(recovered.retryCount
          ? { code: "financial_recovery_unavailable" }
          : {}),
        backlog:
          recovered.backlog ||
          Boolean(recovered.nextCursor || recovered.paymentCursor),
      });
    } catch {
      // Provider and database errors may include credentials; never return their text.
      results.push({
        scope,
        status: "retry",
        code: "financial_recovery_unavailable",
      });
    }
  }
  checkpoint.scopes = {};
  if (examined + offset === page.items.length) {
    checkpoint.scopeCursor = page.nextCursor;
    delete checkpoint.scopeOffset;
  } else checkpoint.scopeOffset = offset + examined;
  await finishFinancialRecoveryRun(run.token, checkpoint);
  return {
    examined,
    nextCursor: page.nextCursor,
    backlog:
      examined + offset < page.items.length ||
      Boolean(page.nextCursor) ||
      results.some((result) => result.status === "retry" || result.backlog),
    results,
  };
}
