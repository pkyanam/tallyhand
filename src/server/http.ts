/**
 * SERVER ONLY — never import from client components.
 *
 * HTTP helpers for API v1 route handlers: response envelopes, pagination,
 * and error shapes. Every success body is `{ data: ... }` (lists add
 * `meta`); every error body is `{ error: { code, message } }`.
 */

const JSON_HEADERS = { "content-type": "application/json" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** 200 with `{ data }` envelope. */
export function ok(data: unknown): Response {
  return json({ data });
}

/** 201 with `{ data }` envelope. */
export function created(data: unknown): Response {
  return json({ data }, 201);
}

/** 204, empty body. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** 404 `{ error: { code: "not_found", ... } }`. */
export function notFound(resource: string): Response {
  return json(
    { error: { code: "not_found", message: `${resource} not found` } },
    404,
  );
}

/** 400 `{ error: { code: "bad_request", message, details? } }`. */
export function badRequest(message: string, details?: unknown): Response {
  const error: { code: string; message: string; details?: unknown } = {
    code: "bad_request",
    message,
  };
  if (details !== undefined) error.details = details;
  return json({ error }, 400);
}

/**
 * 409 `{ error: { code: "conflict", ... } }` — a create with this id already
 * exists. The browser mirror retries creates after partial failures, so a
 * duplicate id is a retry signal (PUT-style upsert intent), not a
 * validation failure. For custom messages + details, see
 * `src/app/api/v1/_lib/errors.ts`.
 */
export function conflict(resource: string): Response {
  return json(
    {
      error: {
        code: "conflict",
        message: `${resource} with this id already exists`,
      },
    },
    409,
  );
}

export interface Pagination {
  limit: number;
  /** Offset into the full result set. */
  cursor: number;
}

/**
 * Parse `?limit=` (default 50, max 200) and `?cursor=` (opaque base64
 * offset token from a previous response's `meta.nextCursor`).
 */
export function parsePagination(req: Request): Pagination {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Math.min(
    200,
    Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50),
  );
  let cursor = 0;
  const cursorParam = url.searchParams.get("cursor");
  if (cursorParam) {
    try {
      const decoded = Buffer.from(cursorParam, "base64").toString("utf8");
      const n = Number(decoded);
      if (Number.isInteger(n) && n >= 0) cursor = n;
    } catch {
      /* malformed cursor → start over */
    }
  }
  return { limit, cursor };
}

/**
 * Slice a full result array into a `{ data, meta }` page. `nextCursor` is
 * an opaque base64 token, or null when this is the last page.
 */
export function paginated<T>(
  all: T[],
  limit: number,
  cursor: number,
  total?: number,
): Response {
  const data = all.slice(cursor, cursor + limit);
  const nextOffset = cursor + data.length;
  const nextCursor =
    nextOffset < all.length ? Buffer.from(String(nextOffset)).toString("base64") : null;
  return json({
    data,
    meta: { limit, nextCursor, total: total ?? all.length },
  });
}