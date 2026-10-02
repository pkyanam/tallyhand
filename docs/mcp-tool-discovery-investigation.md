# MCP tool-discovery investigation

Status: **unresolved**. This document records reproducible engineering evidence,
not a confirmed host defect or a verified fix. It contains no customer data,
credentials, raw account logs, or reviewer access information.

## Reported failure

- The remote endpoint is `https://tallyhand.xyz/api/mcp`.
- The current package is 0.3.5, installable from the repository marketplace:
  `codex plugin marketplace add pkyanam/tallyhand`, then
  `codex plugin add tallyhand@tallyhand`.
- A user reports Codex CLI **0.160.0** showing `tallyhand: connected (86 tools)`
  in `/mcp`, but the agent cannot find `update_settings` in its available tool
  registry. The installed setup skill references that operation.
- `get_settings`, `get_profile`, `get_workspace_capabilities`, `list_clients`
  and `list_projects` were callable in that CLI session.
- A separate ChatGPT connection also omitted `update_settings`. A second
  private package identity did not fix it. Do not create more private plugin
  entries or assume reinstallation is a remedy.
- A temporary disappearance of **all** settings access was separately explained
  by an accidental uninstall. Reinstallation restored reads, but the specific
  missing-write-tool report remained. Do not conflate these incidents.

## Verified application-side evidence

The relevant baseline is commit
`953f57116b5daa66be1e532f1254cd7349a69824`. Earlier diagnostic changes are in
`d1c40f6fe9bde9a55e3dc95c37b2fde7b30014f5`.

1. The application registers **86** tools, including **12** `update_*` tools.
   It returns them in one `tools/list` result, without `nextCursor`. Source
   registration order is not alphabetical; `update_settings` is not last.
2. Production catalog instrumentation observed OAuth-authenticated legacy
   discovery generating all 86 definitions, all 12 update definitions, and
   `update_settings`, followed by HTTP 200 responses. This proves the server
   handler's catalog, not the host's final imported/model-facing registry.
3. Local HTTP endpoint tests cover protocol revisions 2025-03-26, 2025-06-18,
   2025-11-25 and 2026-07-28, including JSON and progress/SSE paths. All return
   the complete catalog. The settings dry-run dispatch reaches the real REST
   handler successfully with synthetic business and invoice inputs.
4. Read-only and read/write OAuth grants produce identical discovery catalogs.
   `update_settings` and working client/project creation operations advertise
   the same `tally:read` + `tally:write` scopes. Calls still enforce scopes;
   discovery does not hide write operations.
5. CLI checks against a locally running compiled Next.js production build
   succeed over real HTTP in legacy and modern modes, with 86 tools. These use
   a synthetic local API token and do **not** certify live Clerk OAuth.
6. The production catalog's exact static JSON fingerprint was reproduced
   locally using the web lockfile's Zod version. All 86 input schemas compile
   with the SDK's AJV validator. The settings schema accepts a synthetic
   Net-30/Direct-Deposit dry-run. Standards-valid JSON Schema is not proof that
   a particular host accepts the same schema subset.

## Relevant implementation

- `cli/src/mcp.ts`: core registration, scopes, settings tool and callbacks
- `cli/src/mcp-server.ts`: complete catalog handler and top-level auth metadata
- `cli/src/mcp-auth.ts`: scope policy and legacy consent challenges
- `cli/src/mcp-extensions.ts`, `mcp-features.ts`: remaining operations/resources
- `cli/src/settings-schema.ts`: shared typed settings patch validation
- `src/app/api/mcp/route.ts`: middleware-independent auth gate and HTTP transport
- `src/lib/auth/oauth.ts`: Clerk verification, audience and scope checks
- `src/server/internal-api.ts`: in-process dispatch to the same REST handlers
- `src/app/api/v1/settings/route.ts`: settings read/patch/dry-run implementation
- `plugins/tallyhand/`: portable package, Codex overlay, skills and logo
- `.agents/plugins/marketplace.json`: generated repository marketplace adapter

## Known diagnostic and packaging corrections

- SDK descriptor parsing can strip unknown top-level `securitySchemes`.
  The server explicitly publishes that field and its `_meta` mirror. The CLI
  catalog diagnostic preserves descriptor extensions while validating standard
  MCP fields. This is already fixed and was not sufficient to resolve the
  reported host omission.
- The root lockfile resolves Zod **4.3.6**, while the CLI lockfile resolves
  **4.6.5**. Installing both dependency trees changes local schema serialization
  (including union representation and email patterns) compared with root-only
  CI builds. Account for this before comparing fingerprints. Both versions
  returned all tools in local checks. No causal link to host exclusion is proven.
- Package 0.3.5 adds missing skill `agents/openai.yaml` presentation metadata
  required by the local Codex package validator and the repository marketplace.
  It is a packaging/distribution release, not a verified missing-tool fix.
- The private ChatGPT test entry and the repository marketplace are separate
  distributions. Installing a repository package does not update that saved
  private entry. Skills/package versions do not pin the hosted MCP server.

## Unproven hypotheses

Host import/schema conversion, per-session exposure/filtering, tool search,
catalog size limits, stale definitions, and local configuration remain possible.
Do not declare any of them the cause without evidence from the failing client.

An earlier agent reported 76 tools, while a later pasted list contained only 51
and admitted truncation. Neither is a trustworthy complete inventory. Sorting
the real catalog puts `timer_stop` at 74, `update_client` at 75,
`update_contract` at 76, and `update_settings` at 84. This is a testable clue,
not proof of an alphabetical cutoff. No numeric plugin tool-count cap was
established from the official documentation reviewed.

## Recommended local investigation

1. Record the installed Codex version, plugin version/source, enabled state,
   effective MCP configuration and actual transport. Redact credentials.
   Check for multiple definitions named `tallyhand` before changing anything.
2. Compare `/mcp verbose` with the **actual model-callable registry**, including
   an exact search for `update_settings` and a complete `update_*` inventory.
   Follow discovery pagination or deferred-tool loading where the client
   supports it. Do not treat an agent's prose claim as a raw inventory.
3. Capture the authenticated server catalog through the Tally CLI using an
   existing authorized credential. Never publish the credential or account
   output. Separate transport discovery, imported definitions, model exposure,
   tool dispatch and API validation as distinct stages.
4. Inspect permitted local Codex startup/diagnostic logs and official source
   for skipped/rejected tools, schema conversion, tool budgets or permission
   filtering. Honor access denials. Do not upload raw home-directory logs.
5. If `update_settings` is actually exposed, run only a synthetic `dryRun: true`
   preview after user approval. Distinguish permission challenge, validation
   error, and absent tool. Do not save settings, create records, send invoices,
   or run recurring schedules as part of diagnosis.
6. Demonstrate a minimal causal reproduction before changing names, schemas,
   auth or packaging. Preserve scope enforcement, user isolation, declared
   safety annotations and 1:1 CLI/API coverage. Do not introduce a generic
   executor or aliases to evade host review or permission controls.

Useful local checks:

```sh
npm ci
npm --prefix cli ci
npx vitest run src/app/api/mcp/catalog-contract.test.ts
npm --prefix cli test
npm --prefix cli run typecheck
node scripts/build-agent-skills.mjs --check
python3 scripts/package-agent-plugin.py --check
node scripts/build-plugin-marketplace.mjs --check
npm run lint
npm test
npm run build
```

`tally mcp catalog --names` reads the bundled CLI catalog, not host acceptance.
`tally mcp catalog --compare host-tools.json` compares unprefixed tool names.
`tally mcp check --transport http --protocol legacy` uses saved CLI credentials;
adding `--workspace` also reads account data. Do not mistake API-key checks for
an OAuth consent/refresh test.

## Completion criteria

Identify the precise stage and condition that removes the tool, supply a
minimal reproduction, and verify the correction in a fresh Codex CLI session.
The host must expose the expected inventory and successfully perform an approved
settings preview without saving. Report remaining ChatGPT-specific differences
and untested OAuth behavior explicitly. Do not call marketplace launch ready
solely because server tests or package validation pass.
