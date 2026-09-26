import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * Serves the OpenAPI 3.1 document for API v1. No auth — the spec itself
 * carries no data. Agents: fetch this first to learn the full surface.
 */
export async function GET() {
  const text = readFileSync(join(process.cwd(), "openapi", "tallyhand.v1.json"), "utf8");
  return new Response(text, { headers: { "content-type": "application/json" } });
}
