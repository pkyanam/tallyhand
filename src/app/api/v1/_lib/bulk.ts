/**
 * Bulk-create validation (route-private `_lib`).
 *
 * Contract: validate EVERYTHING before creating ANYTHING — a batch with a
 * validation failure returns 400 with per-index details and creates
 * nothing, so agents never have to reconcile partial validation failures.
 * Whole-batch idempotency still comes from the `Idempotency-Key` header
 * via withIdempotency.
 */
import type { z } from "zod";

export interface BulkItemError {
  index: number;
  issues: unknown;
}

/**
 * Run a create schema over each raw item, collecting failures with their
 * index. Returns `{ ok: true, items }` or `{ ok: false, errors }`.
 */
export function validateBulk<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown[],
): { ok: true; items: z.infer<S>[] } | { ok: false; errors: BulkItemError[] } {
  const errors: BulkItemError[] = [];
  const items: z.infer<S>[] = [];
  raw.forEach((item: unknown, index: number) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      errors.push({ index, issues: parsed.error.issues });
    } else {
      items.push(parsed.data);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}

export { MAX_BULK_ITEMS } from "@/core/api-limits";

/**
 * Duplicate-id pre-check for bulk create (mirror retry-safety). Runs after
 * schema validation and before any write, honoring the validate-first
 * contract:
 * - an id appearing at two indexes in the same batch → `inBatch` (the
 *   request contradicts itself);
 * - an id that already exists in storage → `existing` (a retried batch).
 * Both lists carry per-index details naming the offending indexes.
 */
export async function findDuplicateIds(
  items: Array<{ id?: string }>,
  exists: (id: string) => Promise<boolean>,
): Promise<{ inBatch: BulkItemError[]; existing: BulkItemError[] }> {
  const inBatch: BulkItemError[] = [];
  const existing: BulkItemError[] = [];
  const firstIndex = new Map<string, number>();
  const dupIndexes = new Map<string, number[]>();
  items.forEach((item, index) => {
    const id = item.id;
    if (!id) return;
    const first = firstIndex.get(id);
    if (first === undefined) {
      firstIndex.set(id, index);
    } else {
      const list = dupIndexes.get(id) ?? [first];
      list.push(index);
      dupIndexes.set(id, list);
    }
  });
  for (const [id, indexes] of dupIndexes) {
    for (const index of indexes) {
      const others = indexes.filter((i) => i !== index);
      inBatch.push({
        index,
        issues: [
          {
            message: `duplicate id "${id}" in batch (also at index ${others.join(", ")})`,
          },
        ],
      });
    }
  }
  for (const [id, index] of firstIndex) {
    if (dupIndexes.has(id)) continue; // already reported as an in-batch duplicate
    if (await exists(id)) {
      existing.push({
        index,
        issues: [{ message: `id "${id}" already exists` }],
      });
    }
  }
  return { inBatch, existing };
}
