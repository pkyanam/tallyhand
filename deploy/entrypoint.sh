#!/bin/sh
# Tallyhand container entrypoint.
# Waits for Postgres (when TALLY_STORAGE=postgres), applies pending
# drizzle/*.sql migrations, then execs the app. Safe to re-run: migrations
# are recorded in the schema_migrations table and skipped when applied.
set -eu

if [ "${TALLY_STORAGE:-dexie}" = "postgres" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "entrypoint: TALLY_STORAGE=postgres requires DATABASE_URL" >&2
    exit 1
  fi
  echo "entrypoint: waiting for Postgres…"
  node ./deploy/migrate.mjs --wait
  echo "entrypoint: applying migrations…"
  node ./deploy/migrate.mjs --migrate
fi

exec "$@"
