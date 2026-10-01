/** Agent playbook served as the MCP `tally://guide` resource and in the README. */

export const GUIDE = `# Tallyhand agent playbook

Tallyhand is a local-first time tracker + invoicer for contractors. This CLI/MCP
surface talks to a Tallyhand server over REST (/api/v1). The pure browser-PWA
IndexedDB mode is NOT HTTP-reachable — point at a server-backed deployment.

## Auth

Every route except GET /health and GET /openapi.json needs
\`Authorization: Bearer <token>\`. Provide it via (first wins):
1. \`--api-url\` / \`--token\` flags
2. \`TALLYHAND_API_URL\` / \`TALLYHAND_API_TOKEN\` env vars
3. \`~/.tallyhand/config.json\` → \`{ "apiUrl": "...", "token": "..." }\`

## Conventions you must follow

- **Money**: CLI/MCP inputs are **dollars** (e.g. amount 42.50, rate 150) and are
  sent as dollars for \`amount\`/\`rate\`/line-item fields — that matches the
  Tallyhand domain. The one exception is \`--amount-cents\` (retainer create),
  which takes integer **cents** literally, mirroring the API's \`amountCents\`
  field. Rule of thumb: dollars unless the flag/field name says cents.
- **Time**: ms epoch everywhere. CLI accepts \`YYYY-MM-DD\` (local midnight).
- **Open timer = task with \`endAt\` missing or 0.** \`timer start\` creates such
  a task; \`timer stop\` patches \`endAt\` + \`durationMinutes\`. Never invent
  your own representation.
- **Idempotency**: every POST carries an auto-generated \`Idempotency-Key\`,
  so retrying a timed-out POST will not double-create. The API also honors a
  client-supplied \`Idempotency-Key\` on POST/PUT/PATCH — always send one for
  writes in agentic loops (one key = one logical write).
- **Pagination**: lists default to 50, max 200, cursor-based. Follow
  \`meta.nextCursor\` until null (the CLI does this automatically).
- **Filtering & sorting**: lists take \`?sort=<field>\` / \`?sort=-<field>\`
  (descending), plus filters like \`status\`, \`clientId\`, \`isBilled\`,
  \`date_from\`/\`date_to\` (ms epoch or ISO date). Examples: list overdue
  invoices with \`overdue=true\`; tasks for a month with
  \`date_from=2026-09-01&date_to=2026-09-30&sort=-startAt\`.
- **Dry run**: append \`?dry_run=true\` (CLI: \`--dry-run\`) to deletes,
  \`invoice send\`/\`paid\`, and scheduler runs to preview the change without
  mutating. Use it before any destructive step you are unsure about.
- **Errors**: \`{ "error": { "code", "message", "details?" } }\`. 400 =
  validation (details carry zod issues), 401 = bad/missing token, 404 =
  unknown id, 409 = valid request but forbidden by current state (e.g.
  deleting a client that still has projects — details explain why).

## Typical flows

**Track then bill:**
1. \`timer start --project <id> --note "API design"\` (or \`log --project <id> --minutes 90 --note ...\` for after-the-fact entries)
2. \`timer stop\` (or \`timer stop --id <id>\` when several run)
3. \`unbilled --client <id>\` to review hours + amounts
4. \`invoice draft --client <id>\` → review the printed total
5. \`invoice send <id>\` then \`invoice paid <id>\`

**Recurring billing:** \`recurring create --client <id> --name "Monthly retainer"
--frequency monthly --mode fixed --line-items '[{"description":"Retainer","quantity":1,"rate":2000}]'\`
then \`recurring run\` (or \`--id\`) for an explicit run. The open web app checks due schedules on startup and every 15 minutes, throttled to at most one automatic run per hour per browser. There is no always-on server cron provisioned by creating a schedule. For unattended execution while the app is closed, configure an external authenticated runner. Runs create drafts only; sending is separate.

**Retainers:** \`retainer create --client <id> --name "Q3 block" --type
prepaid-hours --hours 40 --amount-cents 600000\` (cents here: $6,000).

**Month-end:** \`report revenue --month 2026-09\` (paid invoices issued that
month); \`invoice list --overdue\` shows sent-but-unpaid past due.

**Bulk import:** \`POST /api/v1/tasks/bulk\` and \`/expenses/bulk\` take
\`{ items: [...] }\` — validated before anything is written: one bad item
400s the whole batch with per-index details and creates nothing, so you never
reconcile partial validation failures.

## Gotchas

- \`timer stop\` with zero running timers errors ("no running timer"); with
  several it errors and tells you to pass \`--id\`. Use \`timer status\` first.
- \`invoice draft\` only creates a **draft** — nothing is marked billed until
  \`invoice send\`. Drafts are safe to create and discard.
- Invoice **status is a lifecycle, not a field**: change it only via
  \`invoice send\` / \`invoice paid\` (API: \`POST /invoices/{id}/send|/paid\`) —
  PATCH rejects status changes, and \`send\` is refused (409) on paid invoices.
- Deletes are guarded: clients/projects with children, billed tasks/expenses,
  and sent/paid invoices all 409 with an explanation — read \`error.details\`.
- \`--items\` / \`--line-items\` take a **JSON array string** — quote it for
  your shell: \`'[{"description":"X","quantity":1,"rate":100}]'\`.
- \`export --entity all\` dumps every entity; prefer \`--format csv --out file\`
  for spreadsheets.
- \`tally doctor\` checks reachability + auth in one go — run it first when
  something looks wrong.
- OpenAPI lives at \`GET /api/v1/openapi.json\` (no auth needed).
`;
