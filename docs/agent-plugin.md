# Tallyhand agent plugin

## Install

Upload the ZIP from `https://tallyhand.xyz/plugins/tallyhand-0.3.3.zip` using ChatGPT's Plugins → Upload plugin flow. Connect Tallyhand with OAuth when prompted. For Codex, install the `plugins/tallyhand` directory using its plugin installation workflow. Both use the same hosted MCP URL, `https://tallyhand.xyz/api/mcp`.

The portable `plugin.json` and `mcp.json` are canonical. `.codex-plugin/plugin.json` and `.mcp.json` provide compatibility with older local plugin tooling. No credentials, private app IDs, hooks or executable installation scripts are included in the ZIP.

Self-hosters can change the MCP URL to their own deployment. The CLI remains available at `https://tallyhand.xyz/setup.sh`; rerunning the installer updates an existing installation while preserving its configuration. Use `tally login`, not a token in shell arguments.

## Five focused skills

- setup-workspace: business profile → defaults → client → project → reviewed billing policy
- track-work: timers, manual time, expenses, mileage and rates
- bill-client: draft review, recurring templates, retainers, sharing and reminders
- review-finances: revenue, receivables, expenses, tax records and reconciliation
- manage-workspace: settings, backups/import/reset and secure account controls

The server also implements the currently draft Skills extension: `skills/list`, `skills/get` and content-addressed `resources/read`. These five skills are static submission snapshots; changing them requires rebuilding and rescanning the plugin. Regenerate embedded resources with `node scripts/build-agent-skills.mjs`; CI checks for drift.

## Coverage and boundaries

The CLI/MCP parity map is maintained in `cli/src/mcp-parity.ts` and checked in CI. The release exposes 91 tools: existing time/client/project/invoice/expense/recurring/retainer/settings/backup operations, plus mileage, contracts, tax-payment records, rate cards, shares, overdue-reminder previews/runs, stable account identity, capability discovery and secure control links.

- Workspace reads/writes: account-scoped REST handlers shared by CLI and MCP
- Credentials, user administration, payment authorization, PDF printing, browser notifications, offline-browser export and PWA installation: explicit secure UI links
- Tax payments are bookkeeping records, not bank transfers or tax filings
- Contract records do not sign agreements
- Public share creation requires explicit target/audience approval
- Invoice send/paid, deletion, reset/import and reminder runs require separate approval
- Bulk creation validates the batch, but provider implementations may not guarantee atomic commit on runtime failure; inspect outcomes before retries

## Current limitations

Client-specific invoice-default overrides and previous-calendar-month recurring cutoffs remain follow-up work. Existing recurring unbilled schedules sweep all dates and reserve sources when creating drafts; the skills describe this accurately. A saved schedule does not itself install a background runner. Workspace onboarding is a documented recipe, not an atomic transaction.

## Authentication

Clerk OAuth uses PKCE, exact resource audience and read/write/manage scopes. Bearer API keys remain supported. Stable profile identity comes from the validated account ID; business contact email is not represented as the authenticated account's email. Temporary verification-service failures return retryable 503 responses rather than falsely invalidating credentials.

Reconnect success alone does not establish refresh-token reliability. Verify initial consent, additional scope consent, expiration/refresh, account switching and revocation in the actual host before public submission.

## Release verification

Run static checks and CI, then use `tally mcp check --workspace` for modern MCP and `--protocol legacy` for compatibility. The CLI verifies tool parity, resources/prompts, five skill manifests and SHA-256 hashes, authenticated profile/settings and safe elicitation cancellation. Manual account QA uses only the CLI.

## Public catalog readiness

The ZIP is an installable development distribution, not a claim of official catalog approval. Before submitting: confirm publisher identity/domain ownership, publish accurate privacy policy and terms, provide a review account with synthetic records, prepare five positive/three negative test cases and a walkthrough, and complete the official submission review. Do not invent legal URLs or promise acceptance.

Official references checked October 1, 2026:
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/submission

## Imported tool troubleshooting

Each skill declares its Tallyhand MCP dependency in `agents/openai.yaml`. Use `tally mcp catalog --tool update_settings` to inspect the bundled schema without network or account access. Use the authenticated CLI MCP check for deployed coverage. Neither proves that the host has imported or approved a tool: inspect its tool list and scan findings, refresh the connection and start a new conversation. See [submission readiness](plugin-submission-readiness.md) for the public review checklist.

`business.email` is a single primary address; `business.billingEmails` contains up to ten additional invoice-display contacts. Neither field silently adds invoice-email recipients.
