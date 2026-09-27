# File storage decision: on-demand only (no object storage needed)

**Decision: keep everything on-demand; do not add object storage for
invoices, PDFs, or share links.** The cheapest correct storage decision is
zero storage.

## What the app actually serves

| Artifact | How it's served today | Stable hosted URL needed? |
|---|---|---|
| Invoice PDF | Rendered **client-side** by `@react-pdf/renderer` (`PdfDownloadButton`), downloaded as a blob in the browser | No — no server route, nothing persisted |
| Client share link `/share/[token]`, `/invoice/public/[token]` | **Server-rendered HTML page**, generated per request from the live invoice | No — the URL *is* the page; nothing is uploaded anywhere |
| Expense receipts / logos (future) | `getAttachmentStore()`: local disk by default, S3-compatible store when `S3_*`/`R2_*` env vars are set | Only for uploads — already env-gated, never required |

Nothing in the invoice/PDF/share-link flows produces a file that must be
hosted at a stable URL. On-demand rendering (client-side PDF, server-rendered
share page with cache-friendly GETs) covers every flow with **$0 storage
cost** and no upload/delete lifecycle to maintain.

## Why not R2 for PDFs

Generating a PDF per download is cheap (~tens of ms client-side) and always
reflects the current invoice; caching a rendered PDF in R2 would add
write-through invalidation (edit invoice → stale PDF), an upload path, and
key management — for no user-visible gain. Server-rendered share pages
likewise can't be replaced by static files without losing the signed-token
capability model.

## The one real storage need: uploads

Receipts and logos are the only true uploads. Those already go through the
env-gated `getAttachmentStore()` (`src/core/storage/attachments.ts`):

- **Default (no env):** local disk — $0, fine for local/docker (compose
  mounts a volume).
- **Cloudflare R2 (`R2_*`):** the cheapest hosted option —
  **10 GB storage, 1M Class-A + 10M Class-B ops/month free, $0 egress**.
  A receipts workload (a few hundred photos/month, <1 GB) fits entirely in
  the free tier: **$0/month**.
- **Generic S3 (`S3_*`):** AWS S3 standard at this volume is also ~$0
  ($0.023/GB-mo + $0.09/GB egress), but R2's zero egress makes it the
  default recommendation.

Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (endpoint derived automatically) to enable it;
omit all `S3_*`/`R2_*` vars and the app keeps working on local disk with no
behavior change.

## Cost math (summary)

| Choice | Monthly cost at Tallyhand scale |
|---|---|
| On-demand PDF + HTML share pages | **$0** (decision: this) |
| R2 for receipts (if enabled) | **$0** (inside free tier: 10 GB / 10M reads) |
| AWS S3 for receipts (if enabled) | ~$0–1 (storage + egress at this volume) |

Bottom line: invoices, PDFs, and share links cost nothing and need no
configuration. Object storage is an opt-in upload backend only.
