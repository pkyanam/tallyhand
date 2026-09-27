# Deploying Tallyhand on Vercel Hobby (free tier)

This guide deploys Tallyhand to **Vercel Hobby (free)** with an all-free
stack: **Neon** Postgres, **Clerk** auth, **Cloudflare R2** attachments,
**Stripe test mode**. Nothing in this guide costs money, and nothing in the
app has paywalls, feature gates, or usage limits.

Live deployment: <https://tallyhand.vercel.app>
(Production branch: `main` — Vercel auto-deploys every push to `main`.)

## 1. Free-tier audit (2026-09-26)

Audit of this branch against Vercel Hobby serverless constraints:

- **Runtimes.** All API routes run on the Node.js runtime (Vercel's default).
  Eleven routes (`/api/admin/*`, `/api/auth/builtin/*`, `/api/health`,
  `/api/share/*`) were missing the explicit segment config and now carry
  `export const runtime = "nodejs";`, matching the rest of the tree. No
  route uses the Edge runtime. Middleware runs on Edge as required and only
  imports `next/server` (Clerk is loaded via dynamic `import()` only in
  clerk mode).
- **No always-on processes.** `instrumentation.ts` only registers the
  plugin registry per function instance — no `setInterval`, no workers, no
  daemons. The recurring-invoice scheduler is a **client-side** React effect
  (`RecurringSchedulerCheck`: fires on app open, then every 15 min while a
  tab is open, with a localStorage lock). There are also server-side,
  idempotent, token-authed endpoints — `POST /api/v1/scheduler/run` and
  `POST /api/v1/dunning/run` — ready for a scheduler; see §10.
- **No Vercel paid add-ons.** The repo references no `@vercel/blob`,
  `@vercel/kv`, or `@vercel/postgres`. Attachments use S3-compatible
  storage (R2 works via `S3_*` env vars); Postgres is plain `pg` +
  Drizzle against Neon.
- **Durations.** No route sets `maxDuration`. Hobby (Fluid Compute) allows
  up to 300 s per invocation — far above what any route needs (all routes
  are single-request DB/HTTP work). If a future batch route ever times
  out, add `export const maxDuration = 60;` (Hobby max: 300).
- **Bundle hygiene.** Heavy deps are never in the critical client bundle:
  `qrcode` and `@react-pdf/renderer` load via dynamic `import()` in the
  PDF download flow; `nodemailer`, `pg`, `@aws-sdk/client-s3`, and
  `@clerk/nextjs` load server-side only via `require`/dynamic import
  behind their env-var branches.
- **Storage on Vercel.** `TALLY_STORAGE=sqlite` (or the default `dexie`,
  which falls back to sqlite server-side) does **not** persist on Vercel —
  the filesystem is ephemeral. The only supported Vercel storage is
  `TALLY_STORAGE=postgres` (Neon) or `TALLY_STORAGE=convex`.

## 2. Prerequisites

- A [Vercel](https://vercel.com) account (Hobby plan is fine).
- The repo connected to Vercel via GitHub (`pkyanam/tallyhand`), or the
  Vercel CLI (`npx vercel`).
- Accounts (all free): [Neon](https://neon.tech),
  [Clerk](https://dashboard.clerk.com), [Cloudflare](https://dash.cloudflare.com)
  (for R2, optional), [Stripe](https://dashboard.stripe.com) (test mode, optional).

## 3. Clerk app (auth)

1. Go to <https://dashboard.clerk.com> → **Add application**. Name it
   `Tallyhand`; enable the sign-in methods you want (Email is enough).
2. In the app's **API Keys** page, copy:
   - **Publishable key** (`pk_test_…` / `pk_live_…`)
   - **Secret key** (`sk_test_…` / `sk_live_…`)
3. These become three Vercel env vars (§7):
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — **the Clerk Next.js SDK reads
     this exact name**; without it, sign-in components fail in the browser.
   - `CLERK_PUBLISHABLE_KEY` — same value again (the app's own env
     validation checks this name).
   - `CLERK_SECRET_KEY` — secret; server-side only.
4. First admin: after your first sign-in, open the Clerk dashboard →
   your user → **Public metadata** → set `{ "role": "admin" }`. Admin
   routes (`/api/admin/*`) check this.

## 4. Neon database (Postgres)

1. Create a project at <https://console.neon.tech> (free tier: 0.5 GB
   storage, generous compute hours — plenty for this app).
2. In the Neon dashboard → **Connection Details**, copy the **pooled**
   connection string (the host ends in `-pooler.…`; pooling is on by
   default on the free tier). Use the **pooled** string for `DATABASE_URL`
   — serverless functions spin up many instances and a plain
   non-pooled URL will exhaust connections. (The unpooled/direct string
   is only needed for running migrations locally.)
3. Format: `postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DB?sslmode=require`
4. **Apply migrations.** The schema lives in `drizzle/` (SQL files) and
   `src/lib/db/postgres-schema.ts`. On Vercel, chain migrations into the
   **Build Command** so every deploy migrates first:

   ```
   npx drizzle-kit migrate && next build
   ```

   (`npx drizzle-kit migrate` reads `DATABASE_URL` via `drizzle.config.ts`
   and applies pending `drizzle/*.sql` files. Alternatively
   `node ./deploy/migrate.mjs --migrate` does the same without
   drizzle-kit.) Set `DATABASE_URL` in the Vercel project's env vars
   **before** the first deploy so the build-time migration has a target.

## 5. Stripe test mode (optional — invoices & webhooks)

All of this is in **test mode** — no real money moves.

1. <https://dashboard.stripe.com> → toggle **Test mode** (top right).
2. **Developers → API keys**: copy the **Secret key** (`sk_test_…`) →
   `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://tallyhand.vercel.app/api/v1/stripe/webhook`
   - Events: `checkout.session.completed` (that's the only event the
     handler acts on; others are acknowledged and ignored).
4. After creating the endpoint, reveal the **Signing secret**
   (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
5. The webhook handler is idempotent (already-paid invoices are a no-op,
   Stripe retries deliveries) and signature-verifies every delivery with
   a 5-minute replay tolerance.
6. Set `TALLYHAND_APP_URL=https://tallyhand.vercel.app` (or
   `NEXT_PUBLIC_APP_URL`) so Stripe checkout success/cancel URLs are
   absolute. Payment links are created per invoice via
   `POST /api/v1/stripe/payment-links`.

## 6. Cloudflare R2 attachments (optional — receipts)

Without object storage, receipt attachments fall back to local disk,
which is **ephemeral on Vercel** (uploads vanish on the next deploy).
For persistent receipts, use R2 (free: 10 GB storage, generous egress):

1. Cloudflare dashboard → **R2** → Create bucket (e.g.
   `tallyhand-attachments`).
2. **R2 → Manage R2 API Tokens** → Create API token with Object Read &
   Write on that bucket. Note the token's **Access Key ID** and
   **Secret Access Key**, plus your **Account ID**.
3. Set:
   - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `S3_BUCKET=tallyhand-attachments`
   - `S3_REGION=auto`
   - `S3_ACCESS_KEY=…`, `S3_SECRET_KEY=…`

## 7. Vercel environment variables

Set these in the Vercel dashboard: **Project → Settings → Environment
Variables** (Production; Preview/Development as needed). Generate
secrets with `openssl rand -hex 32` — never commit them.

| Name | Kind | Where to obtain | Required when |
|---|---|---|---|
| `TALLY_STORAGE` | config | you choose | **Always on Vercel: `postgres`** (`sqlite`/`dexie` are ephemeral) |
| `TALLY_AUTH` | config | you choose | **Always on Vercel: `clerk`** (`none` = open to the world) |
| `DATABASE_URL` | secret | Neon → pooled connection string (§4) | `TALLY_STORAGE=postgres` |
| `CLERK_PUBLISHABLE_KEY` | config | Clerk dashboard → API Keys (§3) | `TALLY_AUTH=clerk` (app's env validation checks this name) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public | same value as above | `TALLY_AUTH=clerk` (**the Clerk SDK itself reads this name**) |
| `CLERK_SECRET_KEY` | secret | Clerk dashboard → API Keys (§3) | `TALLY_AUTH=clerk` |
| `TALLY_SHARE_SECRET` | secret | `openssl rand -hex 32` (min 32 chars) | hosted mode (always, when storage/auth are hosted) — signs share links; rotating invalidates outstanding links |
| `TALLYHAND_API_TOKEN` | secret | `openssl rand -hex 32` | using `/api/v1`, `/api/mcp`, the CLI, or scheduler endpoints against the deployment |
| `TALLYHAND_HOSTED_CLI_USER_ID` | config | `/api/admin/users` (list users) | when `TALLYHAND_API_TOKEN` is set — token requests are attributed to this user |
| `TALLYHAND_APP_URL` | config | `https://tallyhand.vercel.app` | Stripe configured (checkout redirects); overrides `NEXT_PUBLIC_APP_URL` |
| `STRIPE_SECRET_KEY` | secret | Stripe dashboard → Developers → API keys, **test mode** (`sk_test_…`) | accepting invoice payments (optional) |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe dashboard → Developers → Webhooks → endpoint (§5) (`whsec_…`) | Stripe webhooks (optional) |
| `S3_ENDPOINT` | config | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | persistent attachments via R2 (optional; §6) |
| `S3_BUCKET` | config | R2 bucket name | with `S3_ENDPOINT` |
| `S3_REGION` | config | `auto` for R2 | with `S3_ENDPOINT` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | secret | Cloudflare → R2 API token (§6) | with `S3_ENDPOINT` |
| `APP_BASE_URL` | config | deployment URL | **not needed on Vercel** — builtin magic-link auth only (self-host) |
| `BUILTIN_AUTH_SECRET` | secret | — | builtin auth only (self-host), not Vercel |
| `SMTP_HOST/PORT/USER/PASS/FROM/SECURE` | secret | your mail provider | builtin magic-link email only; not needed with Clerk |

### Minimum viable set (Clerk + Neon, no payments)

```
TALLY_STORAGE=postgres
TALLY_AUTH=clerk
DATABASE_URL=postgresql://…-pooler.…/…
CLERK_PUBLISHABLE_KEY=pk_…
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…   (same value)
CLERK_SECRET_KEY=sk_…
TALLY_SHARE_SECRET=<64 hex chars>
```

Add `TALLYHAND_API_TOKEN` + `TALLYHAND_HOSTED_CLI_USER_ID` when you want
CLI/MCP/API access.

## 8. Deploy

**Dashboard (recommended):**

1. Vercel → **Add New → Project** → Import `pkyanam/tallyhand`.
2. Framework preset: **Next.js** (auto-detected). Root directory: repo root.
3. **Build Command**: `npx drizzle-kit migrate && next build`
   (runs pending Postgres migrations before building; needs `DATABASE_URL`
   set — step 4 of §7).
4. **Install Command**: default (`npm install`; `node_modules` handling is
   standard).
5. Add the env vars from §7 (Production at minimum).
6. **Deploy.** Production deploys track the `main` branch; every push to
   `main` redeploys automatically.

**CLI:**

```bash
npx vercel --prod
```

## 9. Post-deploy verification

Replace `https://tallyhand.vercel.app` with your deployment URL and
`<token>` with `TALLYHAND_API_TOKEN`.

```bash
BASE=https://tallyhand.vercel.app

# 1. Liveness + env-contract check (fails loudly with 503 if env is wrong)
curl -s $BASE/api/health | jq .

# 2. v1 health (version of the running build)
curl -s $BASE/api/v1/health | jq .

# 3. Auth is enforced: unauthenticated /api/v1 must 401
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/clients

# 4. Authenticated request works
curl -s -H "Authorization: Bearer <token>" $BASE/api/v1/clients | jq .

# 5. OpenAPI spec is served (matches the running build)
curl -s $BASE/api/v1/openapi.json | jq '.info.version'

# 6. MCP endpoint answers (stateless Streamable HTTP)
curl -s -X POST -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}' \
  $BASE/api/mcp | head -c 300; echo

# 7. Stripe webhook rejects unsigned deliveries (when configured)
curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/api/v1/stripe/webhook
# expect 400 (missing stripe-signature), not 500

# 8. Browser: open $BASE, sign in via Clerk, create a client + invoice,
#    download a PDF, and (Stripe test mode) complete a test checkout.
```

## 10. Recurring invoices & dunning (optional scheduling)

Recurring-invoice drafting currently happens **in the browser** via
`RecurringSchedulerCheck` (on app open + every 15 min, localStorage lock,
errors swallowed). If you want it to run without anyone opening the app:

- **Vercel Cron (Hobby): max ~2 jobs, each at most once per day**
  (sub-daily expressions fail the deployment). Cron sends `GET` with
  `Authorization: Bearer <CRON_SECRET>` (set `CRON_SECRET` in env).
- The billing endpoints today are `POST` + `TALLYHAND_API_TOKEN`-authed:
  `POST /api/v1/scheduler/run` (idempotent) and
  `POST /api/v1/dunning/run` (idempotent, supports `?dry_run=true`).
- Free, any-frequency alternative: an external cron such as
  [cron-job.org](https://cron-job.org) (free) `POST`ing to those paths
  with the API-token bearer header — no code changes needed.
- Wiring Vercel Cron natively requires adding `GET` handlers that accept
  the `CRON_SECRET` bearer on those routes; deliberately not done in this
  branch — see the parent merge plan before adding.

## 11. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `/api/health` returns 503 with `problems` | Env contract violated — the JSON names the exact missing/short vars; add them in Vercel → Settings → Environment Variables and redeploy. |
| Build fails on `drizzle-kit migrate` | `DATABASE_URL` missing at build time, or the string is the **direct** (non-pooled) Neon URL with wrong host. Use the pooled URL; it works for migrations too. |
| Clerk sign-in page shows "Publishable key not found" | Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (public, `NEXT_PUBLIC_` prefix). `CLERK_PUBLISHABLE_KEY` alone is not enough for the browser SDK. |
| API returns 401 with a token you just created | Token mismatch — Vercel env var edits require a redeploy to take effect (or use `vercel env` + redeploy). |
| Data disappears between deploys | `TALLY_STORAGE` is `sqlite`/`dexie` — the Vercel filesystem is ephemeral. Switch to `TALLY_STORAGE=postgres`. |
| `too many clients` / connection errors from Neon | `DATABASE_URL` is the direct (non-pooled) string. Swap to the `-pooler.…` pooled string. |
| Receipt uploads vanish | No `S3_*` set → local-disk fallback (ephemeral). Configure R2 per §6. |
| Stripe checkout redirects to localhost | Set `TALLYHAND_APP_URL=https://tallyhand.vercel.app` (the fallback chain is `TALLYHAND_APP_URL` → `NEXT_PUBLIC_APP_URL`). |
| Webhook deliveries fail signature check | `STRIPE_WEBHOOK_SECRET` is from a different endpoint or live mode vs test mode mismatch. Re-copy the signing secret from the exact endpoint in test mode. |
| Cold-start slowness on first request | Normal on Hobby; the Node.js runtime + lazy `require()`s keep it to one cold start per function instance. |
| Build OOM / "JavaScript heap out of memory" | Rare on this repo (no huge deps); retry the deploy first — Vercel occasionally flakes. |

## 12. Free-tier limits to keep in mind

| Resource | Hobby limit | This app's usage |
|---|---|---|
| Function duration | up to 300 s/invocation | ms-scale DB/HTTP calls |
| Cron jobs | ~2 jobs, once/day each | none by default (see §10) |
| Bandwidth | 100 GB/mo | tiny (PWA + JSON API) |
| Build minutes | 6,000 min/mo | ~1–2 min per build |
| Neon free | 0.5 GB storage | fine for single-user/small-team |
| Clerk free | 10k MAU | fine |
| R2 free | 10 GB storage | receipts only |
| Stripe test mode | free, unlimited test transactions | — |

No paywalls, no feature gates, no usage-limit code anywhere in the app.
