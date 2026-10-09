# Financial core: Release 1 operations

Release 1 implements invoice collection, durable payment attempts, verified Stripe events, payment allocations, provider-originated refund tracking/reconciliation and invoice financial timelines. Owners initiate refunds in Stripe for this release; Tallyhand refund commands remain Release 2. This implementation does not complete Agora migration or add a hosted asynchronous agent.

## Supported configurations

| Backend | Online financial support |
| --- | --- |
| SQLite | Self-hosted single-user only, with auth disabled and user/workspace identity `local`/`local`. Hosted-auth SQLite is rejected. Durable customer-share collection is unsupported. |
| PostgreSQL / Neon | Owner-isolated financial storage and transactions implemented; requires `DATABASE_URL`. |
| Convex | Owner-scoped atomic mutations implemented; requires the Convex URL and matching `TALLY_CONVEX_SERVER_SECRET` on the app and Convex deployment. |
| Browser/local storage | Manual billing and drafts; no server-authoritative online collection. |

Online money is safe integer minor units, limited to USD and EUR (two decimal places). Other currencies and amounts not representable in minor units fail closed before dispatch. Existing manual invoice currencies and legacy calculations remain available.

## Authority and client behavior

Broad workspace write access does not authorize collection. Owners issue separate financial grants to an API token or OAuth principal, scoped to workspace, Stripe account, test/live mode, allowed actions (`collect`, `read`, `reconcile`), currency and maximum minor-unit amount. Revocation and authority are checked again before dispatch. Customer collection uses a verified, current invoice-share capability rather than an agent grant; unsupported capability storage fails closed.

Agent requests send `X-Tally-Financial-Grant`. Checkout uses `POST /api/v1/stripe/payment-links` with a stable `Idempotency-Key` (1–128 letters, digits, underscores or hyphens). Reuse that key when retrying the same request; changed input conflicts. Attempts are stored before the provider call and carry a stable provider key. A lost response or expired dispatch lease is an unknown outcome: HTTP 202 means awaiting reconciliation, not failure and not permission to create another charge. Recovery reads provider state; it never redispatches the financial command.

Read surfaces are `GET /api/v1/financial/payments` and `GET /api/v1/financial/invoices/{id}`. `POST /api/v1/financial/reconcile` performs bounded recovery. CLI `financial timeline|payments|reconcile|checkout` and the MCP financial operation use the same REST boundary; supply `--grant`, and for checkout `--invoice-id` and a stable `--operation-id`. Reconciliation continuations include work, payment and provider cursors; preserve all returned continuations when paging manually.

Financial attempts freeze invoice terms and money. Verified payment/refund records refer to that frozen history. Updates to an invoice cannot rewrite historical money: paid-status projection is guarded against a changed invoice, and receipts retain the frozen document. Pending and failed refunds do not reduce confirmed balances; confirmed refunds do, without regressing a confirmed outcome. An out-of-order refund with an unknown parent payment remains retryable.

Payment confirmation, provider-reported payout and bank receipt are distinct evidence. Bank settlement is unverified; neither a checkout redirect nor provider payout establishes bank receipt. Current manual “mark paid” records an attributed `manualPaymentAssertion` atomically with the invoice lifecycle update in its owning backend. Owner financial history exposes this as a separate `manualAssertion` invoice projection, preserving the invoice's original total and currency; it never manufactures a Stripe payment or bank receipt. Historical paid flags without provider records or an attributed assertion have unknown payment provenance. The financial store's separate manual-evidence extension is not the current mark-paid production path.

## Connections and deployment

Hosted collection requires an explicit Stripe Connect account; it has no implicit platform-account fallback. Modern Stripe OAuth responses without an account access token store an encrypted snapshot of the configured platform secret, bound to the explicitly authorized OAuth account and mode. Legacy account-token records continue to work. After platform key rotation, reconnect each account to replace its stored snapshot. Preserve `TALLY_ENCRYPTION_KEY` and encrypted connection records; missing/decryption-invalid credentials fail closed.

Before enabling collection on a deployment:

1. Configure a supported backend, durable storage, account connection, encryption and the existing Stripe OAuth/webhook settings. For Convex, deploy the matching schema/functions and server secret.
2. Configure `CRON_SECRET` and a scheduler cadence that calls `GET` or `POST /api/internal/financial/recover` with `Authorization: Bearer <CRON_SECRET>`. The endpoint alone does not schedule work; cadence must be configured by the deployment operator. Missing/incorrect authorization returns 401.
3. Verify account/mode isolation, signed-event receipt and recovery on the target backend in Stripe test mode before relying on it for real collections. This document does not claim deployment or real Stripe verification.

The worker holds a global 300-second lease and uses a 45-second work budget (the route declares a 300-second maximum duration). It discovers bounded scope pages, saves per-scope recovery checkpoints and advances fairly across scopes. Provider listing is bounded and resumable through stored continuations. Overlapping runs return `skipped: already_running`; scope failures return `status: retry` without exposing provider errors. Monitor scheduler failures, `backlog`, retry results and progress across repeated runs; a successful HTTP response can still report unfinished work.

Payment confirmation commits financial records, audit and outbox atomically. Notification consumers run afterward with at-least-once delivery and a stable `eventId`; consumers must deduplicate retries. This is not the full Agora outgoing-webhook control suite.

## Recovery and rollback

For unknown/pending attempts or delayed refunds, retain the attempt, operation key, provider identity and scope. Run authorized reconciliation or let the configured worker resume it. Inspect the timeline and provider evidence; do not delete attempts or issue replacement operations to resolve ambiguity. Quarantined mismatches require owner review rather than forced allocation. Restore unavailable backend/connection credentials, then retry recovery with its saved continuations.

Before rollback, stop new collection requests and scheduler invocations, preserve a database backup plus encrypted connection records/keys, and record in-flight attempts and provider events. Keep one authoritative event processor. Older checkout/webhook code does not implement this ledger's guarantees; reverting executable code does not reverse external payments or remove the need to reconcile in-flight work. Do not erase ledger/outbox/checkpoint data or reset idempotency identities to make rollback appear clean. Resume collection only with a compatible processor and verified recovery of outstanding states.

## Evidence limits

Hosted browser QA used isolated PostgreSQL. Production Stripe OAuth, signed webhook delivery, Neon transport and deployed Convex smoke checks have not been performed. Local/controlled tests and implemented adapters do not establish these deployment outcomes. Full Agora absorption, migration/retirement, refund initiation and managed asynchronous billing remain later-release work under the [approved design](designs/tallyhand-agora-shared-core.md).
