import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, ok } from "@/server/http";
import { runDunning } from "@/server/dunning";
import { withIdempotency } from "../../_lib/idempotency";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

/**
 * Run dunning: compute reminder + late-fee actions for overdue invoices,
 * persist reminder logs and fee applications, and emit `onInvoiceOverdue`
 * for newly-overdue invoices.
 *
 * - `?dry_run=true` (or `{ "dryRun": true }`) previews without persisting.
 * - Optional body `{ "invoiceIds": [...] }` scopes the run.
 * - Idempotent via `Idempotency-Key` (real runs only — dry-run previews
 *   bypass idempotency so a retried key can't replay a preview).
 */
export async function POST(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;

  // Parse + validate before idempotency: the wrapper only inspects
  // headers, so reading the body here is safe.
  const body: unknown = await req.json().catch(() => null);
  const parsed = body as { dryRun?: unknown; invoiceIds?: unknown } | null;

  const dryRun = isDryRun(req) || (parsed != null && parsed.dryRun === true);
  let invoiceIds: string[] | undefined;
  if (parsed != null && parsed.invoiceIds !== undefined) {
    if (
      !Array.isArray(parsed.invoiceIds) ||
      !parsed.invoiceIds.every((id) => typeof id === "string")
    ) {
      return badRequest("invoiceIds must be an array of strings");
    }
    invoiceIds = parsed.invoiceIds;
  }

  const run = async () => {
    const provider = getServerProvider();
    const settings = await provider.getSettings();
    const report = await runDunning(provider, settings, { dryRun, invoiceIds });
    return ok(report);
  };

  if (dryRun) return run();
  return withIdempotency(req, run);
}
