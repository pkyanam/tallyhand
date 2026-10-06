# Tallyhand API v1 — Agent Quickstart

The REST API lets AI agents (and scripts, and the `tally` CLI) drive Tallyhand
without a browser. It uses the configured server storage provider: SQLite,
Postgres/Neon, or Convex. The hosted deployment uses Convex with per-user
isolation. Browser-only IndexedDB data is not accessible through hosted APIs.

Canonical machine-readable spec: `GET /openapi.json`. The existing
`GET /api/v1/openapi.json` URL serves the same API-owned document.

## Enabling

```bash
export TALLYHAND_API_TOKEN="a-long-random-secret"   # required — API returns 503 without it
export TALLYHAND_DB_PATH="$HOME/.tallyhand/tallyhand.db"  # optional — this is the default
export TALLY_STORAGE="sqlite"                      # local server storage
export TALLY_AUTH="none"                           # single-user local mode
```

Then start the Next.js server (`npm run dev` / `npm start`). The API lives at
`<origin>/api/v1`.

## Auth

Hosted users create a personal API key at
https://tallyhand.xyz/settings/connect. Workspace routes accept:

```
Authorization: Bearer <personal-api-key-or-resource-bound-OAuth-access-token>
```

`/api/v1/health` and both OpenAPI URLs are public. OAuth uses Clerk, S256
PKCE, user consent and resource `https://tallyhand.xyz/api/mcp`, including
when the token is used for REST workspace operations. Scopes are `tally:read`,
`tally:write` and `tally:manage`; request only those needed. Discover the
authorization server through `/.well-known/oauth-protected-resource/api/mcp`.
Browser-session JWTs are not OAuth access tokens. API-key and OAuth-client
management require browser sign-in, not an API key or OAuth bearer token.
See the [integration guide](https://tallyhand.xyz/docs/integrations).

Self-hosted single-user deployments can configure `TALLYHAND_API_TOKEN`
instead. Missing/invalid credentials return 401; a disabled single-user
API returns 503. Provider-specific operations may be unavailable; query
`GET /api/v1/capabilities` before using them.

## Remote MCP

The same deployment also serves the MCP server over **Streamable HTTP**
(stateless) at `<origin>/api/mcp` — one deployment for web, REST, and MCP.
It exposes the exact same tools as `tally mcp` (local stdio), so anything
written against one transport works on the other. It accepts a personal API
key or a resource-bound Clerk OAuth access token in the Bearer header.
OAuth must be enabled and configured by the server operator; see
[MCP details](mcp.md). The example below uses an API key.

Point any MCP client at it:

```json
{
  "mcpServers": {
    "tallyhand": {
      "url": "https://tallyhand.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <TALLYHAND_API_TOKEN>" }
    }
  }
}
```

Or with the TypeScript SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://tallyhand.example.com/api/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.TALLYHAND_API_TOKEN}` } } },
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
```

Notes:

- Stateless mode: no `Mcp-Session-Id`, every request stands alone — safe
  behind any number of instances or serverless functions.
- Each request is executed with *your* token against this deployment's own
  `/api/v1`, so auth, validation, and rate limits are identical to REST.
- `tally mcp` (stdio) remains the pick for local clients like Claude Code;
  `/api/mcp` is for remote agents that can't spawn a subprocess.

## The core loop: client → time → invoice → cash

```bash
BASE=http://localhost:3000/api/v1
H="Authorization: Bearer $TALLYHAND_API_TOKEN"

# 1. Client (set defaultRate once — invoice line items inherit it)
curl -s -X POST $BASE/clients -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"Acme Corp","email":"billing@acme.com","defaultRate":150}' | tee /tmp/cli.json
CLI=$(node -e "console.log(require('/tmp/cli.json').data.id)")

# 2. Project under that client
PRJ=$(curl -s -X POST $BASE/projects -H "$H" -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$CLI\",\"name\":\"Website redesign\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")

# 3. Log time (ms epochs; server derives durationMinutes)
curl -s -X POST $BASE/tasks -H "$H" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PRJ\",\"name\":\"API integration\",\"startAt\":1758852000000,\"endAt\":1758859200000,\"tags\":[\"backend\"]}"

# 4. Draft invoice — server fills invoiceNumber, subtotal/total, line-item ids/amounts
INV=$(curl -s -X POST $BASE/invoices -H "$H" -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$CLI\",\"issueDate\":1758852000000,\"dueDate\":1760061600000,\"lineItems\":[{\"description\":\"Website redesign — September\",\"quantity\":20,\"rate\":150,\"sourceType\":\"manual\"}]}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")

# 5. Send it — flips to sent AND marks linked tasks/expenses billed (atomic, idempotent)
curl -s -X POST $BASE/invoices/$INV/send -H "$H"

# 6. Money arrived
curl -s -X POST $BASE/invoices/$INV/paid -H "$H"
```

## Recurring billing

```bash
# Fixed $2,000/mo retainer fee, starting Oct 1
SCH=$(curl -s -X POST $BASE/recurring-schedules -H "$H" -H 'Content-Type: application/json' \
  -d '{"clientId":"'$CLI'","name":"Acme monthly retainer","mode":"fixed","frequency":"monthly","interval":1,
       "lineItems":[{"description":"Monthly retainer — dev support","quantity":1,"rate":2000}],
       "startDate":"2026-10-01"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.id")

# Bill it right now (works even before it's due)
curl -s -X POST $BASE/recurring-schedules/$SCH/run -H "$H"

# Or run everything due (put this on cron — hourly/daily; safe to re-run)
curl -s -X POST $BASE/scheduler/run -H "$H"
```

Unbilled mode (`"mode":"unbilled"`, empty `lineItems`) sweeps the client's
uninvoiced tasks + expenses into a draft each run instead.

## Conventions agents must know

- **Envelopes**: success → `{ data }`, lists add `meta: { limit, nextCursor, total }`;
  errors → `{ error: { code, message, details? } }`.
- **Pagination**: `?limit=` (default 50, max 200), `?cursor=` (opaque base64 from
  `meta.nextCursor`; `null` = last page).
- **Filtering**: `?clientId`, `?projectId`, `?status` (invoices, schedules, retainers),
  `?isBilled=true|false` (tasks, expenses), `?overdue=true` (sent invoices past
  due), `?category` (expenses), `?type` (retainers), `?search` (name substring).
  Snake_case aliases work everywhere: `client_id`, `project_id`, `is_billed`,
  `include_archived`.
- **Date ranges**: `?date_from=` / `?date_to=` accept ms epochs or ISO-8601 strings
  (invalid values → 400).
- **Sorting**: `?sort=<field>` or `?sort=-<field>` for descending. Allowed fields
  are per-entity (e.g. tasks: `startAt,endAt,durationMinutes,name,createdAt`;
  invoices: `issueDate,dueDate,total,invoiceNumber,createdAt`); an invalid field
  → 400 naming the allowed ones.
- **Idempotency**: send `Idempotency-Key: <uuid>` on POST, PATCH, and PUT.
  Retries with the same key replay the stored response instead of
  double-executing. Use it for every mutation in a retry loop.
- **Dry-run previews**: `?dry_run=true` on deletes, invoice send/paid,
  `POST /scheduler/run`, and per-schedule runs returns what *would* happen
  without mutating. Dry runs never consume idempotency keys.
- **Dates**: millisecond epochs; ISO-8601 strings are accepted and coerced.
- **Money units**: invoice line items are decimal **dollars**; retainer
  `amountCents` is integer **cents**. Don't mix them up.
- **Billing = send**: creating an invoice never marks work billed — only
  `POST /invoices/{id}/send` does. The scheduler is the exception:
  it claims sources at draft-generation time because it runs unattended.
- **Timers**: an `endAt` of `0` (or omitted) means an open/running timer —
  `timer start` in the CLI creates one; `timer stop` patches `endAt`. Otherwise
  `endAt` must be >= `startAt`.

## Bulk import

```bash
# Up to 200 items per batch; { items: [...] } or a bare JSON array.
# Every item is validated before the first write — one bad item 400s the
# whole batch with per-index details and creates nothing.
curl -s -X POST $BASE/tasks/bulk -H "$H" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <uuid>' \
  -d '{"items":[{"projectId":"'$PRJ'","name":"Review","startAt":"2026-09-20","endAt":"2026-09-20T01:00:00Z","durationMinutes":60}]}'

curl -s -X POST $BASE/expenses/bulk -H "$H" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <uuid>' \
  -d '{"items":[{"clientId":"'$CLI'","date":"2026-09-20","amount":42.50,"category":"travel"}]}'
```

## Invoice lifecycle & deletion guards

- Invoices are **always created as drafts** (initial `status` must be omitted or
  `draft`). `PATCH /invoices/{id}` never accepts `status` — advance it only via
  `POST /invoices/{id}/send` (draft → sent, marks sources billed) then
  `POST /invoices/{id}/paid` (sent → paid). Wrong transitions → 409.
- Deletes are guard-railed: clients/projects/tasks/expenses/schedules refuse with
  **409** while related records exist (`error.details` carries per-relation
  counts, e.g. `taskCount`, `invoiceCount`). Only draft invoices can be
  deleted; deleting one unclaims its billed tasks/expenses.
- Preview anything destructive first with `?dry_run=true`.

## Settings worth setting once

```bash
curl -s -X PATCH $BASE/settings -H "$H" -H 'Content-Type: application/json' -d '{
  "business": {"name":"Jane Doe Consulting","email":"jane@example.com",
               "paymentInstructions":"ACH to ..."},
  "invoice": {"numberPrefix":"INV-","paymentTermsDays":30}
}'
```

## Notes & limits

- Storage is local SQLite today (`TALLYHAND_DB_PATH`); Postgres comes with the
  hosted deployment. Back up the `.db` file like any precious data.
- The browser PWA's IndexedDB and this SQLite DB are separate stores for now —
  bridging them is the sync story (Phase 4), not this API.
