# Tallyhand — Hosted Quickstart

Get a multi-user Tallyhand running on any machine with Docker in ~5 minutes.

## 1. Install

```bash
git clone <your-tallyhand-repo> && cd tallyhand
./install.sh
```

The installer asks two questions and does the rest:

1. **Storage** — Postgres via Docker Compose (recommended), or Convex (external).
2. **Auth** — Clerk (recommended hosted pick), builtin magic links, or none.

It generates secrets, writes `.env` (mode 600), builds the image, runs
`docker compose up`, waits for health, and prints your URLs. Re-running it
is safe: it detects the existing `.env`/containers and offers
Update / Fresh / Start / Quit.

## 2. Sign in

- **Clerk** — open `/login`, sign in with whatever methods you enabled in the
  Clerk dashboard. Then make yourself admin: Clerk dashboard → Users → your
  user → Public metadata → `{ "role": "admin" }`.
- **Builtin** — open `/login`, enter your email. The **first** user to sign
  in automatically becomes admin.
  - With SMTP configured: the login link arrives by email.
  - Without SMTP (the standard self-host fallback): the one-time link is
    printed to the server logs — watch with
    `docker compose -f deploy/docker-compose.yml logs -f app` and forward it.

## 3. Manage users

Open `/admin/users` (admin role required): invite users, assign
`admin`/`member`/`viewer` roles, disable/enable, remove.

## 4. Share with clients

From the app (or `POST /api/share/links`) create a signed link for an
invoice, a timesheet week, or an estimate snapshot. Clients open
`/share/<token>` — no login needed. Timesheets get an **Approve hours**
button; invoices get a **Pay** button (plugin slot — see below).

## What runs where

| Service | Data | Notes |
|---|---|---|
| `app` | — | Next.js; migrations auto-apply on start |
| `db` | `pgdata` volume | Postgres 16 |

Attachments: local disk at `/data/attachments` (the `attachments` volume)
unless `S3_*` is set in `.env` (S3-compatible: AWS, MinIO, R2…).

## Manual (no installer)

```bash
cp .env.example .env   # fill in the hosted values
# Bundled Postgres:
docker compose -f deploy/docker-compose.yml --profile postgres up -d --build
# Convex or external DATABASE_URL (no bundled database):
docker compose -f deploy/docker-compose.yml up -d --build
curl localhost:3000/api/health
```

## Payments

The portal Pay button is a **plugin slot, not Stripe**. Register a handler
with `onSharePaymentRequested()` (see `src/lib/share/payment-slot.ts`) from
a plugin module; it receives `{ shareToken, invoiceId, invoiceNumber,
amountCents, currency }` and may return `{ checkoutUrl }`. With no handler,
the portal shows "payments not configured".

## Secrets & rotation

- `TALLY_SHARE_SECRET` — rotating it **invalidates all outstanding share links**.
- `BUILTIN_AUTH_SECRET` — rotating it signs out all builtin sessions.
- `.env` backups: the installer writes `.env.bak.<timestamp>` before changes.
