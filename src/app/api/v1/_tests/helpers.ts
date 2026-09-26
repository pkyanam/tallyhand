/**
 * Test helpers for API v1 route smoke tests. Route handlers are imported
 * directly and called with real Request objects — no server needed.
 *
 * Handlers only touch req.headers / req.json() / req.nextUrl, so this works
 * under vitest's node environment.
 */
import { existsSync, unlinkSync } from "node:fs";
import { resetServerProviderForTests } from "@/server/provider";
import { tempDbPath } from "@/server/sqlite-provider";

export const TEST_TOKEN = "test-token-123";

/** Build a Request with (or without) the Authorization header. */
export function makeRequest(
  path: string,
  init: RequestInit = {},
  withAuth = true,
): Request {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set("authorization", `Bearer ${TEST_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

export function jsonBody(data: unknown): string {
  return JSON.stringify(data);
}

/** Point the provider at a fresh temp DB and set the API token. */
export function setupApiEnv(): string {
  const dbPath = tempDbPath("tallyhand-api-test");
  process.env.TALLYHAND_API_TOKEN = TEST_TOKEN;
  process.env.TALLYHAND_DB_PATH = dbPath;
  resetServerProviderForTests();
  return dbPath;
}

export function teardownApiEnv(dbPath: string): void {
  resetServerProviderForTests();
  delete process.env.TALLYHAND_DB_PATH;
  if (existsSync(dbPath)) unlinkSync(dbPath);
}

export async function readJson(res: Response): Promise<{ status: number; body: unknown }> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Extract `.data` from a `{ data }` envelope, typed loosely. */
export function dataOf<T>(body: unknown): T {
  return (body as { data: T }).data;
}
