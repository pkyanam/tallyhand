import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, created } from "@/server/http";
import { conflict } from "../../_lib/errors";
import { withIdempotency } from "../../_lib/idempotency";
import { expenseCreateSchema } from "@/server/validation";
import { MAX_BULK_ITEMS, findDuplicateIds, validateBulk } from "../../_lib/bulk";

export const runtime = "nodejs";

/**
 * Bulk-create expenses. Accepts `{ items: [...] }` or a bare JSON array.
 * Every item is validated before the first write (schema + referenced
 * clientId/projectId exist); any failure returns 400 with per-index
 * details and creates nothing. The whole batch shares one
 * Idempotency-Key, so a retried batch never double-creates.
 */
export async function POST(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const raw: unknown = Array.isArray(body)
      ? body
      : (body as { items?: unknown } | null)?.items;
    if (!Array.isArray(raw)) {
      return badRequest("Body must be { items: [...] } or a bare JSON array");
    }
    if (raw.length === 0) {
      return badRequest("items must not be empty");
    }
    if (raw.length > MAX_BULK_ITEMS) {
      return badRequest(`items is limited to ${MAX_BULK_ITEMS} per batch`);
    }

    const validated = validateBulk(expenseCreateSchema, raw);
    if (!validated.ok) {
      return badRequest("Invalid expense items", validated.errors);
    }

    const provider = getServerProvider();

    // Mirror retry-safety: detect duplicate ids up front, before any
    // write, honoring the validate-first contract.
    const dupes = await findDuplicateIds(
      validated.items,
      async (id) => (await provider.getExpense(id)) !== undefined,
    );
    if (dupes.existing.length > 0) {
      return conflict("expense id already exists", dupes.existing);
    }
    if (dupes.inBatch.length > 0) {
      return badRequest("Duplicate expense ids in batch", dupes.inBatch);
    }

    const projectIds = new Set((await provider.listProjects()).map((p) => p.id));
    const clientIds = new Set((await provider.listClients(true)).map((c) => c.id));

    const errors: { index: number; issues: unknown }[] = [];
    validated.items.forEach((item, index) => {
      if (item.projectId && !projectIds.has(item.projectId)) {
        errors.push({
          index,
          issues: [{ message: `projectId "${item.projectId}" does not exist` }],
        });
      }
      if (item.clientId && !clientIds.has(item.clientId)) {
        errors.push({
          index,
          issues: [{ message: `clientId "${item.clientId}" does not exist` }],
        });
      }
    });
    if (errors.length > 0) {
      return badRequest("Invalid expense items", errors);
    }

    const createdItems = [];
    for (const item of validated.items) {
      createdItems.push(await provider.createExpense(item));
    }
    return created(createdItems);
  });
}