# MCP tool-discovery investigation

Status: **root cause identified; app-side fix implemented, deploy pending.**
The failure stage is host-side (Codex CLI/Desktop), not the Tallyhand server.
This document contains no customer data, credentials, raw account logs, or
reviewer access information.

## Root cause

**Codex applies a serialized-model-spec byte budget to every MCP tool served by
an agent plugin. Tools that overflow the budget are silently hidden from the
model.** In codex-rs 0.160.x (`core/src/mcp_tool_exposure.rs`):

- `MAX_AGENT_PLUGIN_MCP_SPEC_BYTES = 8_000` — per-tool cap on the serialized
  spec that would be sent to the model.
- `MAX_AGENT_PLUGIN_MCP_TOTAL_BYTES = 64_000` — cumulative cap across **all**
  tools of one agent plugin.
- Overflowing tools are registered with `ToolExposure::Hidden`: absent from the
  model-facing registry and from tool search, while remaining listed in `/mcp`.

The budget accumulates in the host's **alphabetical tool order** and hides a
contiguous tail. Tallyhand's 86 tool specs summed to ≈75.6 KB (pre-fix), so the
host exposed the first 76 tools and hid the last 10 — all `update_*` tools:

`update_expense, update_invoice, update_mileage_entry, update_project,
update_rate_card, update_recurring_schedule, update_retainer, update_settings,
update_task, update_tax_payment`

`update_settings` alone needs 3,313 bytes; the 76th tool already consumed
63,722 bytes, so it never fit. The working tools (`get_settings`,
`get_profile`, `list_clients`, `list_projects`, plus `update_client` and
`update_contract` at positions 75–76) all fit.

Why the budget overflowed: the host repeats the MCP server's `instructions`
string in **every** tool's serialized namespace spec. Tallyhand's 264-byte
instructions × 86 tools = 22.7 KB (30% of the cap) before any per-tool content.

## Evidence

1. **Host source** (codex-rs `rust-v0.160.0`): the budget constants and the
   first-fit loop in `core/src/mcp_tool_exposure.rs`; per-tool spec building in
   `core/src/tools/handlers/mcp.rs` and `tools/src/responses_api.rs`
   (`model_spec_bytes()` = serialized namespace spec; description capped at
   1,000 bytes; unknown JSON Schema keywords dropped; plugin provenance note
   appended to every description in `codex-mcp/src/rmcp_client.rs`); tool
   ordering by `raw_tool_identity` (alphabetical within a server) in
   `codex-mcp/src/tools.rs`.
2. **Failing-client registry scans** (archived local sessions, 2026-10-01):
   `ALL_TOOLS.filter(x => x.name === "mcp__tallyhand__update_settings")` →
   empty; `startsWith("mcp__tallyhand__").length` → **76**. A second session
   shows `update_client`/`update_contract` present — the exact budget boundary.
   `/mcp` reports the transport-level catalog (86) regardless of exposure,
   which is why the counts disagreed.
3. **Byte-exact replica**: a faithful port of the host pipeline (description
   cap + provenance note, schema sanitize/JsonSchema-subset mapping, namespace
   spec serialization, 8 KB per-tool degrade, 8 KB/64 KB first-fit budget)
   reproduces the observed state exactly against the production catalog
   (86 tools, root-lockfile Zod 4.3.6): **76 exposed / 10 hidden**, hidden set
   identical, cumulative 63,722/64,000.
4. **Minimal live reproduction**: fresh Codex CLI 0.160.0 in a throwaway
   `CODEX_HOME`, with a local fixture plugin serving the exact production
   catalog over stdio (agent-plugin attribution identical to the real
   package). Result: `ALL_TOOLS` contains exactly **76** `mcp__tallyhand__*`
   tools, `update_settings` absent, `get_settings` callable. After applying
   the fix below to the fixture: **86** tools, all twelve `update_*` tools
   present, `update_settings` dispatches (reaching the host approval gate, as
   designed).
5. ChatGPT's separate omission of `update_settings` is consistent with the
   same OpenAI-side exposure logic family, but that path was not directly
   instrumented (see uncertainties).

## Fix (this repository)

The budget lives in the host; the app must fit its catalog inside it. The
narrowly scoped change trims redundant serialized bytes without dropping tools,
renaming anything, or weakening auth:

1. Server `instructions` (cli/src/mcp.ts) 264 → 110 bytes. The dollars/ms
   conventions and draft-before-send guidance remain in tool descriptions and
   the `tally://guide` playbook; the consent and no-credential rules are kept
   verbatim in meaning.
2. `dateArg` format hint loses the redundant `Format:` prefix (13 occurrences).
3. Four verbose tool descriptions tightened (`create_recurring_schedule`,
   `create_invoice_draft`, `bulk_log_time`, `bulk_log_expenses`).

Result (verified with the byte-exact replica and the live fixture): **62,084 /
64,000 bytes — all 86 tools exposed**, ~1.9 KB headroom.

`src/app/api/mcp/catalog-byte-budget.test.ts` guards this: it recomputes the
host spec bytes from the live catalog and fails if any tool exceeds 8,000
bytes or the catalog exceeds 62,500 bytes, so future catalog growth cannot
silently re-trigger host-side hiding.

## Remaining uncertainties

- **ChatGPT cloud path**: the separate ChatGPT connection omitted
  `update_settings` too. Not directly instrumentable from here; expected to
  resolve with the same spec-size reduction, but verify after deploy.
- **Production verification**: the fix is not yet deployed. After deploy, run
  a fresh Codex session (re-install not required; server code is what changed)
  and re-check `/mcp verbose` against a registry scan, then a `dryRun: true`
  settings preview. Do not rely on stale sessions — the host may cache tool
  catalogs for up to 30 minutes per process.
- **Host version drift**: constants were read from codex-rs 0.160.0. A future
  Codex release could change the budget; the guard test documents the
  assumption. A silent policy change could re-hide tools without any local
  signal — worth a bug report (below).
- **Other harnesses** (Claude, Cursor, etc.): different exposure pipelines;
  untested. The 64 KB figure is Codex-specific.

## Sanitized bug report

`docs/codex-agent-plugin-tool-budget-bug-report.md` drafts a sanitized report
for the Codex host: the budget is undocumented, produces no warning or log,
and creates a visible contradiction (`/mcp` lists N tools, the model sees
fewer). Suggested asks: document the constants, log skipped tools, and surface
the discrepancy in `/mcp`.

## Reproducing locally

Fixture assets live in the git-excluded `investigation-tmp/repro/`
(diagnostic only; never commit): a stdio MCP server serving a dumped
production catalog, a local marketplace fixture plugin, and a throwaway
`CODEX_HOME`. To re-verify after a server change:

1. Dump the current catalog: run the catalog-contract test pattern and save
   `tools/list` JSON.
2. Point `investigation-tmp/repro/mcp-server.mjs` at the dump.
3. `CODEX_HOME=<throwaway> codex plugin marketplace add <fixture marketplace>`
   and `codex plugin add tallyhand@repro` (the plugin manifest and MCP config
   must keep their `$schema` fields; `mcp.json` overrides `.mcp.json`).
4. `CODEX_HOME=<throwaway> codex exec "count ALL_TOOLS entries starting with
   mcp__tallyhand__ and check update_settings"`.

Never commit the throwaway home, dumps of live account data, or credentials.

## Historical notes (pre-resolution, kept for context)

- The earlier hypothesis of an alphabetical **tool-count** cutoff was wrong in
  mechanism but right in symptom: the boundary at 76 is where the byte budget
  ran out, not a count cap. No official documentation states the budget.
- Read-only vs read/write OAuth grants produce identical catalogs (still
  true); discovery does not filter by scope; calls still enforce scopes.
- The production catalog fingerprint was reproduced locally with the root
  lockfile's Zod 4.3.6; the CLI lockfile resolves Zod 4.6.5 and produces
  different serialization. The byte-budget math above uses the production
  (root-lockfile) serialization.
- The temporary disappearance of all settings access was an accidental
  uninstall, separately resolved by reinstallation; unrelated to this bug.
- Local checks: `npm test`, `npm --prefix cli test`,
  `npm --prefix cli run typecheck`, `npm run lint`, and the catalog tests all
  pass on the fix branch. `npm run build` was not run (no TS/build impact).
