#!/usr/bin/env node
/**
 * Minimal migration runner for the production image.
 * Applies drizzle/*.sql in filename order, tracking completed files in
 * schema_migrations. Idempotent: re-runs only apply new files.
 * (Keeps drizzle-kit out of the production image.)
 *
 * Usage: node ./deploy/migrate.mjs --wait | --migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = join(root, "drizzle");
const mode = process.argv[2];

async function connectWithRetry() {
  const { Pool } = pg;
  let lastErr;
  for (let i = 0; i < 30; i++) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (err) {
      lastErr = err;
      await pool.end().catch(() => {});
      await sleep(2000);
    }
  }
  throw lastErr ?? new Error("could not reach Postgres");
}

async function main() {
  const pool = await connectWithRetry();
  try {
    if (mode === "--wait") return; // connectivity proven
    if (mode !== "--migrate") throw new Error(`unknown mode ${mode}`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at bigint NOT NULL)`
    );
    const { rows } = await pool.query(`SELECT filename FROM schema_migrations`);
    const done = new Set(rows.map((r) => r.filename));
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (done.has(file)) {
        console.log(`migrate: skip ${file} (already applied)`);
        continue;
      }
      console.log(`migrate: applying ${file}…`);
      const sql = readFileSync(join(drizzleDir, file), "utf8");
      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query(
          `INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)`,
          [file, Date.now()]
        );
        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    }
    console.log("migrate: up to date");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate:", err.message ?? err);
  process.exit(1);
});
