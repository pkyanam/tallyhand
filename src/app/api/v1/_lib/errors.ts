/**
 * API v1 extra error helpers (route-private `_lib`). Pairs with
 * @/server/http's ok/created/noContent/notFound/badRequest.
 *
 * Every error body is `{ error: { code, message, details? } }` — keep it
 * that way when adding new statuses.
 */

const JSON_HEADERS = { "content-type": "application/json" };

/** 409 `{ error: { code: "conflict", ... } }` — the request is valid but the current state forbids it. */
export function conflict(message: string, details?: unknown): Response {
  const error: { code: string; message: string; details?: unknown } = {
    code: "conflict",
    message,
  };
  if (details !== undefined) error.details = details;
  return new Response(JSON.stringify({ error }), {
    status: 409,
    headers: JSON_HEADERS,
  });
}
