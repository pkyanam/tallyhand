import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for hosted Postgres mode (TALLY_STORAGE=postgres).
 * Generate/apply migrations:
 *   npx drizzle-kit generate   # after schema changes
 *   npx drizzle-kit migrate    # applies drizzle/*.sql to DATABASE_URL
 */
export default defineConfig({
  schema: "./src/lib/db/postgres-schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
