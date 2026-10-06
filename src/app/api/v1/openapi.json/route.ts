import { OPENAPI_V1 } from "../_lib/openapi-document";

export const runtime = "nodejs";

/**
 * Serves the OpenAPI 3.1 document for API v1. No auth — the spec itself
 * carries no data. Agents: fetch this first to learn the full surface.
 *
 * The document is embedded in the API-owned `_lib` tree (not read from
 * the repo-root `openapi/` dir) so it always documents the filters,
 * sorting, aliases, dry-run, idempotency, and bulk endpoints this
 * version of the API actually implements.
 */
export async function GET() {
  return Response.json(OPENAPI_V1, { headers: {
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  } });
}
