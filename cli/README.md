# tally — CLI + MCP server for Tallyhand

Drive your Tallyhand time tracking and invoicing from the terminal, from scripts,
or from an AI agent. Talks to a Tallyhand server over REST (`/api/v1`).

> Requires a **server-backed** Tallyhand deployment (local SQLite now, Postgres
> later). The pure browser-PWA IndexedDB mode is not HTTP-reachable — bridging
> that is the sync story, not this package.

## Install

```bash
cd cli
npm install
npm run build

# link locally
npm link
# or install globally from a tarball
npm pack && npm i -g tallyhand-cli-0.1.0.tgz
```

Needs Node ≥ 22.

## Config

```bash
tally config set api-url http://localhost:3000
tally config set token <your-api-token>
```

Resolution order: `--api-url` / `--token` flags → `TALLYHAND_API_URL` /
`TALLYHAND_API_TOKEN` env vars → `~/.tallyhand/config.json`.

> ⚠️ `tally config set token` stores the token in **plaintext** at
> `~/.tallyhand/config.json` (mode 0600). Prefer the env var on shared machines.

`tally doctor` checks reachability + auth in one go — run it first when
something looks wrong.

## Human examples

```bash
# timer: start on a project, stop when done
tally timer start --project abc123 --note "API design" --tags deep-work
tally timer status
tally timer stop

# log after the fact
tally log --project abc123 --minutes 90 --date 2026-09-25 --note "Code review"

# see what's billable
tally unbilled --client def456

# draft → review → send → paid
tally invoice draft --client def456
tally invoice show inv_789
tally invoice send inv_789
tally invoice paid inv_789

# recurring auto-billing
tally recurring create --client def456 --name "Monthly retainer" \
  --frequency monthly --mode fixed \
  --line-items '[{"description":"Retainer","quantity":1,"rate":2000}]'
tally recurring run

# retainer (amount in CENTS here: 600000 = $6,000)
tally retainer create --client def456 --name "Q3 block" \
  --type prepaid-hours --hours 40 --amount-cents 600000

# expenses + export
tally expense add --amount 42.50 --category Travel --note "Train to client"
tally export --entity invoices --format csv --out invoices.csv
```

Every command accepts `--json` for machine-readable output; errors go to
stderr with a hint and exit 1.

## Conventions

- **Money**: dollars everywhere (`--amount 42.50`, `--rate 150`, line-item
  `rate`), matching the Tallyhand domain. The one exception is
  `--amount-cents` on `retainer create`, which takes integer cents literally,
  mirroring the API's `amountCents` field.
- **Time**: ms epoch on the wire; the CLI accepts `YYYY-MM-DD` (local midnight).
- **Open timer** = a task with `endAt` missing or `0`. `timer start` creates one;
  `timer stop` stamps `endAt` + `durationMinutes`.
- **Idempotency**: every POST carries an auto-generated `Idempotency-Key`, so
  retrying a timed-out call won't double-create.
- OpenAPI lives at `GET /api/v1/openapi.json` (no auth needed).

## For AI agents

`tally mcp` launches an MCP server over stdio with 23 tools
(`health_check`, `timer_start`, `timer_stop`, `timer_status`, `log_time`,
`list_unbilled`, `create_invoice_draft`, `send_invoice`, `mark_invoice_paid`,
`list_recurring_schedules`, `create_recurring_schedule`,
`run_recurring_schedules`, `list_retainers`, `create_retainer`, …) plus a
`tally://guide` resource — a playbook covering auth, money/time conventions,
the open-timer representation, idempotency, and the standard
track → bill workflow. **Read `tally://guide` first.**

Claude Code / Claude Desktop config:

```json
{
  "mcpServers": {
    "tallyhand": {
      "command": "tally",
      "args": ["mcp"],
      "env": {
        "TALLYHAND_API_URL": "http://localhost:3000",
        "TALLYHAND_API_TOKEN": "<token>"
      }
    }
  }
}
```

`--json` usage pattern for scripts:

```bash
tally invoice list --status draft --json | jq '.[].total'
```

## Development

```bash
npm test        # vitest (33 tests: client, command handlers, MCP registration)
npm run build   # tsup → dist/
npx tsc --noEmit
```

Source layout: `src/client.ts` (API client + config), `src/commands.ts`
(command handlers), `src/cli.ts` (commander wiring), `src/mcp.ts` (MCP server),
`src/billing.ts` (unbilled math, line items), `src/format.ts` (tables),
`src/guide.ts` (agent playbook).
