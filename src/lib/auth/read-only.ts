/**
 * Viewer read-only enforcement for hosted auth modes.
 *
 * `readOnlyIfViewer` wraps a StorageProvider in a Proxy: write methods
 * throw a 403 error when the current user's role is `viewer`; read methods
 * pass through untouched. The role is resolved lazily on the first write
 * attempt (cached 60s in `@/lib/auth/users`), so pure read traffic pays
 * no directory cost. Role-lookup failures fail closed — writes are denied
 * while reads keep working.
 *
 * Applied in `src/server/provider.ts#getServerProvider` (current-request
 * provider) when TALLY_AUTH != none. Never applied to
 * `getServerProviderForUser` — share resolution acts on the link OWNER's
 * data via the signed capability, not the visitor's role.
 */
import type { StorageProvider } from "@/core/storage";
import type { UserIdSource } from "@/lib/db/hosted-types";
import { getUserRole } from "./users";

/**
 * StorageProvider methods that mutate data. Everything else
 * (list/get/readSettings) is readable by viewers.
 */
export const WRITE_METHODS = new Set([
  "createClient",
  "updateClient",
  "removeClient",
  "createProject",
  "updateProject",
  "removeProject",
  "createTask",
  "updateTask",
  "removeTask",
  "createExpense",
  "updateExpense",
  "removeExpense",
  "createInvoice",
  "updateInvoice",
  "removeInvoice",
  "updateSettings",
  "createRecurringSchedule",
  "updateRecurringSchedule",
  "removeRecurringSchedule",
  "createRetainer",
  "updateRetainer",
  "removeRetainer",
  "assignNextInvoiceNumber",
  "markInvoiceSent",
  "markInvoicePaid",
  "createMileageEntry", "updateMileageEntry", "removeMileageEntry",
  "createContract", "updateContract", "removeContract",
  "createTaxPayment", "updateTaxPayment", "removeTaxPayment",
  "createRateCard", "updateRateCard", "removeRateCard",
  // hosted-only share writes — viewers can't mint links either
  "createShareLink",
  "revokeShareLink",
  "recordTimesheetApproval",
  // encrypted-sync vault write — viewers can pull, never push
  "upsertEncryptedEntities",
]);

export function readOnlyIfViewer(
  base: StorageProvider,
  userIdSource: UserIdSource,
): StorageProvider {
  let verdict: Promise<boolean> | null = null;
  const isReadOnly = (): Promise<boolean> => {
    if (!verdict) {
      verdict = (async () => {
        const uid =
          typeof userIdSource === "string"
            ? userIdSource
            : await userIdSource();
        if (!uid) return true;
        return (await getUserRole(uid)) === "viewer";
      })();
    }
    return verdict;
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || !WRITE_METHODS.has(String(prop))) {
        return value;
      }
      return async (...args: unknown[]) => {
        if (await isReadOnly()) {
          const err = new Error(
            "Viewers have read-only access",
          ) as Error & { status?: number };
          err.status = 403;
          throw err;
        }
        return Reflect.apply(
          value as (...a: unknown[]) => unknown,
          target,
          args,
        );
      };
    },
  });
}
