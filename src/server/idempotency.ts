/**
 * SERVER ONLY — never import from client components.
 *
 * POST idempotency via the `Idempotency-Key` header. When a client retries a
 * POST with the same key (network blip, agent retry), the stored response is
 * replayed instead of executing the handler twice — so "create client" can
 * never double-create.
 *
 * Storage: the `idempotency_keys` table in the same SQLite file (WAL mode),
 * keyed by the client-supplied key.
 *
 * NOTE on TTL: keys conceptually live 24h; there is deliberately no cleanup
 * job in v1 (TODO: add a janitor — either a scheduled DELETE in the
 * scheduler or a lazy purge on write when the table grows).
 */
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "./sqlite-provider";

const IDEMPOTENCY_TABLE = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);`;

interface StoredResponse {
  status: number;
  body: string;
}

/**
 * Wrap a POST handler with idempotency. Non-POST requests and requests
 * without an Idempotency-Key header pass straight through.
 */
export async function withIdempotency(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key || req.method !== "POST") {
    return handler();
  }

  const db = new DatabaseSync(resolveDbPath());
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(IDEMPOTENCY_TABLE);

    const row = db
      .prepare("SELECT status, body FROM idempotency_keys WHERE key = ?")
      .get(key) as StoredResponse | undefined;
    if (row) {
      return new Response(row.body, {
        status: row.status,
        headers: { "content-type": "application/json" },
      });
    }

    const res = await handler();
    const body = await res.text();
    db.prepare(
      "INSERT OR REPLACE INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)",
    ).run(key, res.status, body, Date.now());
    // Rebuild the response: the original's body stream is consumed.
    return new Response(body, { status: res.status, headers: res.headers });
  } finally {
    db.close();
  }
}
