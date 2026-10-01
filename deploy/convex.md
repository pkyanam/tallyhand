# Convex-native hosting

Local Tallyhand needs no cloud account. The normal local app stores records in
the browser, and the SQLite server option remains available. Convex is an
optional hosted backend using your own Convex and authentication accounts.

## Required configuration

| Variable | Next.js host | Convex deployment |
| --- | --- | --- |
| `TALLY_STORAGE=convex` | Required | No |
| `TALLY_AUTH=clerk` | Required for this Clerk setup | No |
| `CONVEX_URL` | Deployment's `.convex.cloud` URL | No |
| `TALLY_CONVEX_SERVER_SECRET` | Private random value, at least 32 characters | Exactly the same value |
| `CLERK_PUBLISHABLE_KEY` | Your Clerk application's public key | No |
| `CLERK_SECRET_KEY` | Your Clerk application's private key | No |
| `CLERK_JWT_ISSUER_DOMAIN` | No | Your Clerk issuer URL |
| `TALLY_SHARE_SECRET` | Separate private random value, at least 32 characters | No |

`NEXT_PUBLIC_CONVEX_URL` is accepted as an alternative to `CONVEX_URL`.
Server credentials must never have a `NEXT_PUBLIC_` prefix. Use provider secret
settings, never checked-in files, URLs, logs, screenshots or chat. Vercel needs
the variables in each environment you deploy to. Keep preview and production
backend deployments and secrets separate. Changing a share secret invalidates
links signed with the old value.

## Deployment order

1. Install dependencies with `npm ci` and sign in to the Convex CLI. Select or
   create your own Convex development project with `npx convex dev`.
2. In Clerk, create a JWT template using the Convex preset, named `convex`,
   with audience `convex`. Set its issuer URL on the Convex deployment.
   If you enable direct native writes, add a `role` claim sourced from trusted
   Clerk public metadata, using the same `member`/`admin`/`viewer` roles as the
   app. Missing or viewer roles cannot write through native Convex functions.
3. Configure the matching private server bridge secret on Next.js and Convex.
   The bridge supports existing authenticated REST/CLI requests and signed
   public share links. It is never included in browser subscriptions.
4. Deploy functions to development using `npx convex dev --once`. For a
   production backend use `npx convex deploy` after configuring its environment.
5. Build and deploy the Next.js application to your chosen host. On Vercel,
   start with a preview configured for the development backend. The app passes
   its public Convex URL to the Clerk realtime provider at runtime.
6. Verify login, client/project creation, time tracking, invoice generation,
   sharing/revocation and a second signed-in browser's realtime refresh. Check
   local-only mode separately. Promote only after hosted checks pass.

## Current implementation boundaries

- Hosted entity storage, contractor tools and realtime workspace invalidation
  use Convex. Existing API and CLI contracts remain supported through Next.js.
- The separate encrypted-vault sync API is currently implemented by the
  Postgres/Neon providers only. Convex entity storage is ordinary hosted data;
  do not describe it as end-to-end encrypted.
- Idempotent API writes keep durable request receipts. A pending or uncertain
  receipt intentionally requires inspection rather than automatically repeating
  a potentially completed financial operation. Receipt retention and automated
  reconciliation are not yet implemented.
- Queries currently materialize workspace lists. Large-workspace pagination,
  attachment size/storage limits and production load testing are still needed.
- A local test pass does not establish that provider authentication, deployment
  configuration or browser flows are working on your hosted instance.

The Docker installer prompts for an existing matching Convex server secret.
It does not create or configure your external Convex project for you.
