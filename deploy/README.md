# Tallyhand Deployment Guide

Covers both deployment shapes. Tallyhand is local-first by default; hosted
mode is strictly opt-in via environment.

## Modes

| | Local | Hosted |
|---|---|---|
| Storage | `sqlite` (file) / `dexie` (browser) | `postgres` (Compose) / `neon` (serverless) / `convex` (external) |
| Auth | `none` | `clerk` / `builtin` |
| Users | one, implicit | many, roles `admin`/`member`/`viewer` |
| Share links | local portable HTML (unchanged) | signed `/share/<token>` portal |

"Hosted" is derived: it turns on when `TALLY_STORAGE` is
`postgres`/`neon`/`convex` or `TALLY_AUTH` is anything but `none`. There is
no `TALLYHAND_MODE`.

## Local (zero-config)

```bash
./install.sh   # → Local
# or: TALLY_STORAGE=sqlite TALLY_AUTH=none npm run dev
```

No Docker, no accounts. Data in `TALLYHAND_DB_PATH` (default
`./data/tallyhand.db`).

## Hosted with Docker Compose

`./install.sh` → Hosted. What it provisions:

- `app` — the Next.js image (`deploy/Dockerfile`, non-root user).
  On boot: waits for Postgres, applies `drizzle/*.sql` via
  `deploy/migrate.mjs` (idempotent, tracked in `schema_migrations`), then
  `next start`.
- `db` — Postgres 16, data in the `pgdata` volume.
- `attachments` volume mounted at `/data/attachments` — the local-disk
  fallback for receipt uploads.

### Reverse proxy notes

Set `APP_BASE_URL=https://tally.example.com` so magic links and share URLs
are absolute and correct. Behind a proxy, forward `X-Forwarded-*` (Next.js
handles the rest); terminate TLS at the proxy. Cookies are `lax`/`httpOnly`;
builtin sessions set `secure` automatically when `NODE_ENV=production`.

### Auth details

**Clerk** (`TALLY_AUTH=clerk`, the hosted pick):
- `@clerk/nextjs` middleware protects the app, `/api/v1`, `/api/admin`,
  and authenticated share endpoints. Public: `/`, `/login`, `/share/**`,
  share resolve/approve APIs, builtin auth endpoints.
- User ids are Clerk user ids; every hosted query is scoped by them.
- Admin UI at `/admin/users` (or the Clerk dashboard) manages roles via
  `publicMetadata.role`. First admin is designated in the Clerk dashboard.

**Builtin** (`TALLY_AUTH=builtin`, self-hosters):
- Email magic links, single-use, 15-minute expiry; sessions are HMAC-signed
  cookies (30 days) keyed by `BUILTIN_AUTH_SECRET`.
- Requires `TALLY_STORAGE=postgres` or `neon` — users/tokens live in
  `builtin_users` / `builtin_login_tokens`.
- No SMTP → the one-time link is printed to the server logs on request
  (documented fallback; the operator forwards it). The API never returns the
  link to the caller.
- First user to sign in becomes `admin` automatically (bootstrap).

**None** (`TALLY_AUTH=none`): single-user, no login. Admin UI/API return 404.

### Machine access to /api/v1

Set `TALLYHAND_API_TOKEN` + `TALLYHAND_HOSTED_CLI_USER_ID`. Clients send
`Authorization: Bearer <token>`; requests are attributed to that user id
(the provider still scopes every query to it — no cross-user access).

## Storage backends

- **sqlite** — server-local file, zero deps. Untouched by this track.
- **dexie** — browser IndexedDB. Untouched. (Server code with
  `TALLY_STORAGE=dexie` falls back to the sqlite file backend with a warning.)
- **postgres** — Drizzle over a node-pg Pool (self-hosted / Compose).
  Schema: `src/lib/db/postgres-schema.ts`; migrations: `drizzle/*.sql`.
  After schema changes: `npx drizzle-kit generate` then restart the app
  container.
- **neon** — same Postgres schema via Neon's serverless HTTP driver
  (`@neondatabase/serverless` + `drizzle-orm/neon-http`): no long-lived
  connections, so it survives scale-to-zero hosts (Vercel) where a pg Pool
  gets its sockets killed. Set `TALLY_STORAGE=neon` (or the `TALLY_DB=neon`
  alias) with `DATABASE_URL` = your Neon **direct** (non-`-pooler`)
  connection string — a `-pooler` hostname is normalized automatically.
  With `TALLY_STORAGE` unset, a `DATABASE_URL` pointing at `*.neon.tech`
  selects `neon` automatically. Caveat: neon-http has no interactive
  transactions, so multi-statement workflows (invoice numbering, mark-sent)
  run as sequential statements rather than one atomic transaction —
  acceptable for single-user books, not for high-contention writers.
- **convex** — `convex/schema.ts` + functions in `convex/tally.ts`
  (called via string paths like `tally:clientsList` — no codegen import on
  the Next side). Deploy with `npx convex dev`, set `CONVEX_URL`. Every
  function takes `userId` and scopes by it.

## Encrypted cloud sync (E2E)

Opt-in per user, only when signed in (`TALLY_AUTH=clerk`/`builtin`) — never
in local mode. Requires `TALLY_STORAGE=postgres` or `neon` (the vault is the
`encrypted_entities` table; the Compose entrypoint applies `drizzle/*.sql`
including `0004_encrypted_entities.sql`).

- The browser generates a per-user AES-GCM-256 data key on first sign-in and
  keeps it in IndexedDB (`tallyhand-sync`); the key **never leaves the
  device** — there is no server-side encryption secret to configure.
- The server stores only opaque `{ iv, ciphertext }` snapshots and enforces
  last-write-wins on `updatedAt`; it cannot read user data.
- Enable it in Settings → Cloud Sync. Copy the sync key to a second device
  (or a safe place) BEFORE you need it: losing the key makes the cloud
  ciphertext permanently unreadable — there is no recovery.
- Machine clients: the same vault works over `/api/v1/sync/*` with
  `Authorization: Bearer <TALLYHAND_API_TOKEN>` + the `x-tallyhand-sync: 1`
  header.

## Attachment storage

`src/core/storage/attachments.ts` defines the `AttachmentStore` interface;
`src/core/storage/s3-attachments.ts` is the S3-compatible implementation
(loaded dynamically when `S3_BUCKET` is set). Without `S3_*`, receipts stay
on local disk (persist via the `attachments` volume in Compose).

## Share links

- HMAC-SHA256 tokens (`th1.<payload>.<signature>`), per-link DB rows with
  expiry + revocation; rotation of `TALLY_SHARE_SECRET` invalidates all links.
- Authenticated management: `POST/GET /api/share/links`,
  `DELETE /api/share/links/[id]` (owner-scoped — can't touch others' links).
- Public: `GET /api/share/resolve/[token]`, `POST /api/share/approve`
  (one approval per link+week), portal at `/share/[token]`.
- The legacy `src/app/invoice/public/[token]/page.tsx` (browser-Dexie) is
  preserved for local mode.

## User management

Admin UI: `/settings/users` (also at `/admin/users`). API: `/api/admin/users`
(GET list, POST invite), `/api/admin/users/[id]` (PATCH role/disabled,
DELETE). Admin-only; self-disable/self-remove/self-demote are blocked.
Roles: `admin` / `member` / `viewer` (viewer is read-only — writes 403).
Provider mapping: Clerk → Clerk Backend API; builtin → local user table;
none → disabled. Builtin: first-ever user bootstraps as admin; later users
must be invited by an admin before the magic link will send.

## Health & ops

- `GET /api/health` → 200 with `{ storage, auth, hosted }`; 503 when the
  hosted env contract is violated (misconfiguration fails loudly).
- Logs: `docker compose -f deploy/docker-compose.yml logs -f app`
- Update: re-run `./install.sh` → Update (no data loss; volumes persist).
- Backup: `pgdata` volume (+ `attachments`). Example:
  `docker compose -f deploy/docker-compose.yml exec db pg_dump -U tallyhand tallyhand > backup.sql`
