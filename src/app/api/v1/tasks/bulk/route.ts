import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../../_lib/sync-auth";
import { badRequest, created } from "@/server/http";
import { conflict } from "../../_lib/errors";
import { withIdempotency } from "../../_lib/idempotency";
import { taskCreateSchema } from "@/server/validation";
import { MAX_BULK_ITEMS, findDuplicateIds, validateBulk } from "../../_lib/bulk";

export const runtime = "nodejs";

/**
 * Bulk-create tasks (time entries). Accepts `{ items: [...] }` or a bare
 * JSON array. Every item is validated before the first write (schema +
 * projectId exists + endAt >= startAt (or 0 for an open timer)); any failure
 * returns 400 with per-index details and creates nothing. The whole batch
 * shares one Idempotency-Key, so a retried batch never double-creates.
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

    const provider = getServerProvider();
    const projectIds = new Set((await provider.listProjects()).map((p) => p.id));

    const validated = validateBulk(taskCreateSchema, raw);
    if (!validated.ok) {
      return badRequest("Invalid task items", validated.errors);
    }

    // Mirror retry-safety: detect duplicate ids up front, before any
    // write, honoring the validate-first contract.
    const dupes = await findDuplicateIds(
      validated.items,
      async (id) => (await provider.getTask(id)) !== undefined,
    );
    if (dupes.existing.length > 0) {
      return conflict("task id already exists", dupes.existing);
    }
    if (dupes.inBatch.length > 0) {
      return badRequest("Duplicate task ids in batch", dupes.inBatch);
    }

    const fkErrors = validated.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !projectIds.has(item.projectId))
      .map(({ item, index }) => ({
        index,
        issues: [{ message: `projectId "${item.projectId}" does not exist` }],
      }));
    const rangeErrors = validated.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.endAt !== 0 && item.endAt < item.startAt)
      .map(({ index }) => ({
        index,
        issues: [{ message: "endAt must be >= startAt (or 0 for an open timer)" }],
      }));
    const errors = [...fkErrors, ...rangeErrors];
    if (errors.length > 0) {
      return badRequest("Invalid task items", errors);
    }

    const createdItems = [];
    for (const item of validated.items) {
      createdItems.push(await provider.createTask(item));
    }
    return created(createdItems);
  });
}
