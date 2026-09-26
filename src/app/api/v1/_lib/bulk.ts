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

export const MAX_BULK_ITEMS = 200;
