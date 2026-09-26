/**
 * API v1 local write-idempotency (route-private: `_lib` is not a route).
 *
 * Mirrors the semantics of the server-level POST idempotency wrapper, but
 * covers all write methods (POST/PUT/PATCH) since PATCH routes are part of
 * the agent surface. Kept here — rather than in `src/server/idempotency.ts`
 * — because the API layer owns the PATCH idempotency contract and the
 * server module is outside this layer's ownership.
 *
 * A request carrying `Idempotency-Key` executes at most once: retries replay
 * the stored status + JSON body. One key = one logical write; reusing a key
 * across different operations replays the first operation's response.
 * Requests without the header pass straight through.
 *
 * Storage: the same `idempotency_keys` table in the server SQLite file, so
 * keys are shared process-wide. Keys conceptually live 24h; there is no
 * cleanup job in v1 (same as the server wrapper).
 *
 * IMPORTANT: call this only for real mutations. Dry-run previews must be
 * handled BEFORE this wrapper — otherwise a retried dry-run key would
 * replay the preview response instead of executing.
 */
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/sqlite-provider";

const IDEMPOTENCY_TABLE = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);`;

export async function withIdempotency(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key || !["POST", "PUT", "PATCH"].includes(req.method)) {
    return handler();
  }

  const db = new DatabaseSync(resolveDbPath());
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(IDEMPOTENCY_TABLE);

    const row = db
      .prepare("SELECT status, body FROM idempotency_keys WHERE key = ?")
      .get(key) as { status: number; body: string } | undefined;
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
