import type { FinancialStore } from "../../core/financial/store";
import type {
  FinancialScope,
  WorkspaceIdentity,
} from "../../core/financial/types";
import { cleanArgs, type ConvexClientLike } from "../db/convex-provider";

/** Every write is exactly one server-authorized Convex mutation. */
export function createConvexFinancialStore(
  client: ConvexClientLike,
  userId: string,
): FinancialStore {
  if (!userId) throw new Error("Financial owner required");
  const check = (w: WorkspaceIdentity) => {
    if (w.userId !== userId || w.workspaceId !== userId)
      throw new Error("Financial owner/workspace mismatch");
  };
  const call = async <T>(
    write: boolean,
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    const serverSecret = process.env.TALLY_CONVEX_SERVER_SECRET;
    if (!serverSecret || serverSecret.length < 32)
      throw new Error("Financial server authorization required");
    return (await client[write ? "mutation" : "query"](
      `financial:${name}`,
      cleanArgs({ ...args, userId, serverSecret }),
    )) as T;
  };
  const write = <T>(
    name: string,
    input: { scope?: WorkspaceIdentity; workspace?: WorkspaceIdentity },
  ): Promise<T> => {
    const identity = input.scope ?? input.workspace;
    if (!identity) throw new Error("Financial workspace required");
    check(identity);
    return call<T>(true, name, { input });
  };
  return {
    prepareAttempt: (i) => write("prepareAttempt", i),
    claimAttemptDispatch: (i) => write("claimAttemptDispatch", i),
    recordAttemptDispatch: (i) => write("recordAttemptDispatch", i),
    reconcileAttempt: (i) => write("reconcileAttempt", i),
    getAttempt: (scope: FinancialScope, id) => {
      check(scope);
      return call(false, "getAttempt", { scope, id });
    },
    receiveProviderEvent: (i) => write("receiveProviderEvent", i),
    claimProviderEvent: (i) => write("claimProviderEvent", i),
    finishProviderEvent: (i) => write("finishProviderEvent", i),
    applyPaymentOutcome: (i) => write("applyPaymentOutcome", i),
    applyRefundOutcome: (i) => write("applyRefundOutcome", i),
    recordManualEvidence: (i) => write("recordManualEvidence", i),
    getInvoiceTimeline: (workspace, invoiceId, query) => {
      check(workspace);
      return call(false, "getInvoiceTimeline", { workspace, invoiceId, query });
    },
    listPayments: (workspace, query) => {
      check(workspace);
      return call(false, "listPayments", { workspace, query });
    },
    listResumableWork: (scope, now, query) => {
      check(scope);
      return call(false, "listResumableWork", { scope, now, query });
    },
    claimOutbox: (workspace, now, lease) => {
      check(workspace);
      return call(true, "claimOutbox", { workspace, now, lease });
    },
    finishOutbox: (workspace, id, leaseToken, result) => {
      check(workspace);
      return call(true, "finishOutbox", { workspace, id, leaseToken, result });
    },
  };
}
