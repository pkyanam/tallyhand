---
name: "tallyhand"
description: "Drive Tallyhand (local-first freelance time-tracking & invoicing) via REST, the tally CLI, or the MCP server: log time/expenses, draft and send invoices, chase overdue invoices, and report monthly revenue."
---

# Tallyhand

Local-first time-tracking & invoicing. Three agent surfaces share one
semantics (JSON envelope, bearer auth, idempotent mutations, dry-run
previews, guard-railed deletes):

- **REST**: `<origin>/api/v1` — full reference at `GET /api/v1/openapi.json`
  (no auth). Fetch it first when unsure.
- **CLI**: `tally` (see `cli/`) — `tally clients create --name "Acme"`,
  `tally timer start --project p1`, `tally invoice draft …`, etc.
- **MCP**: the CLI doubles as an MCP server (`tally mcp`) with 49 tools —
  `create_client`, `log_time`, `bulk_log_time`, `draft_invoice`,
  `send_invoice`, `mark_invoice_paid`, `overdue_invoices`, `revenue_summary`,
  `run_scheduler`, …

## Auth

Set `TALLYHAND_API_TOKEN` (server) / configure the CLI once (`tally auth`
or env). Every REST route except `GET /health` and `GET /openapi.json`
needs `Authorization: Bearer <token>`. Missing token → 401; token unset
server-side → 503 `api_disabled`.

## Core conventions

- Envelope: success → `{ data, meta? }`, error →
  `{ error: { code, message, details? } }`.
- Lists: `?limit=` (default 50, max 200) + `?cursor=`; follow
  `meta.nextCursor` until null. `?sort=<field>` / `?sort=-<field>`
  (descending); invalid field → 400 naming allowed fields.
- Filters: `clientId`, `projectId`, `isBilled`, `status`, `overdue=true`
  (sent invoices past due), `category`, `type`, `search` (name substring),
  `date_from`/`date_to` (ms epoch or ISO-8601).
- Snake_case aliases work: `client_id`, `project_id`, `is_billed`,
  `include_archived`.
- Mutations accept `Idempotency-Key` (POST/PATCH/PUT); replaying a key
  returns the stored response without re-executing. The CLI sends one
  automatically on every POST/PATCH/PUT.
- `?dry_run=true` previews deletes, invoice send/paid, and scheduler runs
  without mutating. Always preview destructive calls first.
- Money: dollars everywhere (`amount`, `rate`, line items) — except
  retainer `amountCents` (integer cents).
- Times: ms epoch; ISO-8601 strings accepted and coerced.

## Workflow 1 — Log time (and expenses)

Prefer the CLI for single entries, bulk REST for imports.

```bash
# Single entry via CLI
tally timer start --project <projectId> --note "Design review"
tally timer stop                       # patches endAt on the open timer
# or directly:
tally log --project <projectId> --minutes 90 --date 2026-09-20 --note "Review"

# Expense
tally expense create --client <clientId> --amount 42.50 --category travel \
  --date 2026-09-20 --note "Train to client"

# Bulk import (REST): up to 200 items; every item is validated before the
# first write — one bad item 400s the whole batch with per-index details.
curl -X POST $BASE/tasks/bulk -H "$H" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"items":[
    {"projectId":"<id>","name":"Review","startAt":"2026-09-20T09:00:00Z",
     "endAt":"2026-09-20T10:30:00Z","durationMinutes":90,"tags":["design"]}
  ]}'
```

An `endAt` of `0` (or omitted) means an **open/running timer**; otherwise
`endAt` must be >= `startAt` (400 otherwise).

MCP equivalents: `log_time`, `log_expense`, `bulk_log_time`,
`bulk_log_expenses`.

## Workflow 2 — Draft → send → paid invoice

Invoices are **always created as drafts**. Status advances only through
send then paid; `PATCH` never accepts `status`.

```bash
# 1. Draft (line items may reference tasks/expenses by sourceType+sourceId)
INV=$(curl -s -X POST $BASE/invoices -H "$H" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{
    "clientId":"<clientId>","issueDate":"2026-09-26","dueDate":"2026-10-26",
    "lineItems":[{"description":"Design work","quantity":10,"rate":150,
                  "sourceType":"task","sourceId":"<taskId>"}]
  }' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.id")

# 2. Preview the send (shows wouldMarkBilled), then send for real.
#    Sending marks the referenced tasks/expenses billed.
curl -s -X POST "$BASE/invoices/$INV/send?dry_run=true" -H "$H"
curl -s -X POST "$BASE/invoices/$INV/send" -H "$H"

# 3. Mark paid (requires sent first; 409 on draft)
curl -s -X POST "$BASE/invoices/$INV/paid" -H "$H"
```

CLI: `tally invoice draft --client <id> --items '[…]'`,
`tally invoice send <id> [--dry-run]`, `tally invoice paid <id> [--dry-run]`.
MCP: `draft_invoice`, `send_invoice`, `mark_invoice_paid`.

Deleting a **draft** invoice is allowed and unclaims its billed
tasks/expenses; deleting a sent/paid invoice → 409.

## Workflow 3 — Overdue follow-up

```bash
# Sent-but-unpaid past their due date, newest first
curl -s "$BASE/invoices?overdue=true&sort=-dueDate&limit=200" -H "$H"
```

CLI: `tally invoice list --overdue`. MCP: `overdue_invoices`.
Typical agent loop: list overdue → group by client (`clientId`) →
summarize totals and oldest due date per client → draft a nudge message.
Sending the nudge itself is the user's call, not the agent's.

## Workflow 4 — Monthly revenue

Revenue = **paid invoices issued** in `YYYY-MM` (invoices carry no
`paidAt`, so issuance month is the definition).

```bash
# CLI one-liner (groups by client)
tally report revenue --month 2026-09

# REST equivalent
curl -s "$BASE/invoices?status=paid&date_from=2026-09-01&date_to=2026-09-30&limit=200" -H "$H" \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const t=r.data.reduce((s,i)=>s+i.total,0);
    console.log(JSON.stringify({month:'2026-09',invoices:r.data.length,revenue:t}))"
```

MCP: `revenue_summary` with `{ "month": "2026-09" }`.

## Workflow 5 — Recurring billing

```bash
# Fixed-fee schedule (generates a draft invoice each run)
SCH=$(curl -s -X POST $BASE/recurring-schedules -H "$H" \
  -H 'Content-Type: application/json' -d '{
    "clientId":"<id>","name":"Acme monthly retainer","mode":"fixed",
    "frequency":"monthly","interval":1,
    "lineItems":[{"description":"Monthly retainer","quantity":1,"rate":2000}],
    "startDate":"2026-10-01"}' | node -pe "…data.id")

curl -s -X POST "$BASE/recurring-schedules/$SCH/run?dry_run=true" -H "$H"  # preview
curl -s -X POST "$BASE/scheduler/run" -H "$H"   # run everything due (cron-safe)
```

`mode:"unbilled"` with empty `lineItems` sweeps the client's uninvoiced
tasks + expenses into a draft each run instead. MCP: `run_scheduler`,
`force_run_schedule`.

## Deletion guards (read before deleting)

- Client delete → 409 while projects, invoices, direct expenses, recurring
  schedules, or retainers exist.
- Project delete → 409 while tasks, expenses, or recurring schedules exist.
- Task/expense delete → 409 when billed.
- Schedule delete → 409 while a retainer references it.
- `error.details` carries per-relation counts (`taskCount`, …) so you can
  report exactly what blocks the delete.

## Gotchas

- `tally timer stop` with zero running timers errors; with several it
  errors and asks for `--id`. Use `tally timer status` first.
- `invoice draft` only creates a **draft** — nothing is marked billed until
  `send`.
- The scheduler claims sources at draft-generation time (it runs
  unattended); interactive drafts claim at `send`.
- Retainer `amountCents` is cents; everything else money is dollars.
- Re-running `scheduler/run` is safe: nothing due → nothing generated.
