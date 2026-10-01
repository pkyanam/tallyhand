<div align="center">

# Tallyhand

**Time tracking and invoicing for independent contractors — local-first, self-hostable, and scriptable from the terminal or an AI agent.**

[![CI](https://github.com/pkyanam/tallyhand/actions/workflows/ci.yml/badge.svg)](https://github.com/pkyanam/tallyhand/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/pkyanam/tallyhand)](https://github.com/pkyanam/tallyhand/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/pkyanam/tallyhand/blob/main/LICENSE)

</div>

## What it is

Tallyhand is a time tracker and invoicing app built for contractors who bill by the hour. Track your time with a simple timer, turn the hours into professional invoices, and share them with clients — without handing your business data to someone else's cloud.

## CLI quick start

```bash
curl -fsSL https://tallyhand.xyz/setup.sh | bash
tally config set api-url https://tallyhand.xyz
tally login
tally doctor
```

Rerun the installer to update without changing saved configuration. [Setup guide](https://tallyhand.xyz/docs) · [Agent guide](https://tallyhand.xyz/llms.txt).

## Full app install

```bash
curl -fsSL https://raw.githubusercontent.com/pkyanam/tallyhand/main/install.sh | bash
```

This downloads the standalone `tally` CLI for your platform — no Node required. Point it at a running Tallyhand server and go:

```bash
tally config set api-url http://localhost:3000
tally config set token <your-api-token>
```

Or run the full web app locally: clone the repo, `npm install`, `npm run dev`, and open http://localhost:3000.

## 60-second quickstart

```bash
# 1. Start a timer on a project
tally timer start --project abc123 --note "API design"

# ... do the work ...

# 2. Stop it — the entry lands in your ledger
tally timer stop

# 3. Turn the unbilled hours into an invoice
tally invoice draft --client def456
```

From there: `tally invoice send <id>` when it's ready, `tally invoice paid <id>` when the money lands.

## Features

- **Time tracking** — one-command timer with notes and tags, a unified ledger of time and expenses, inline editing, and a weekly reckoning view that finds the hours you forgot to bill.
- **Invoicing** — build invoices from ledger entries or from scratch, preview them live, download as PDF, and track draft → sent → paid.
- **Recurring invoices and retainers** — set up monthly schedules or prepaid-hour retainers that bill automatically.
- **Client portal share links** — give any invoice a read-only public link clients can open without an account.
- **CLI, API, and MCP for agents** — the `tally` CLI, a REST API with an OpenAPI spec, and an MCP server with 23 tools, so scripts and AI agents can track time and bill on your behalf. MCP works locally (`tally mcp`, stdio) or remotely over Streamable HTTP at `/api/mcp` — same deployment, same tools.
- **Local-first and self-hostable** — your data lives in your browser's IndexedDB or your own server's SQLite database. Run it on your laptop, your server, or Vercel — no account required.

## Docs

- [CLI guide](cli/README.md) — every `tally` command, conventions, and MCP setup for Claude Code / Claude Desktop
- [API quickstart](docs/API.md) — auth, the REST endpoints, remote MCP (`/api/mcp`), and the track → bill workflow
- [OpenAPI spec](openapi/tallyhand.v1.json) — machine-readable API reference

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and ideas: use the [GitHub issue templates](https://github.com/pkyanam/tallyhand/issues).

## License

MIT — see [LICENSE](LICENSE).
