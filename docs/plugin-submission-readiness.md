# Tallyhand public plugin submission readiness

Reviewed 2026-10-01. This is a preparation checklist, not an approval or submission claim.

## Sources

- [Packaging](https://developers.openai.com/plugins/build/plugins)
- [Submission and hosted tool review](https://developers.openai.com/plugins/deploy/submission)
- [Guidelines](https://developers.openai.com/plugins/plugin-guidelines)

## Package audit

Our portable root manifest and hosted MCP configuration are the canonical package. Codex compatibility files remain included. Five focused skills each declare their MCP dependency. The archive excludes credentials, private app IDs, hooks and executable installers. Generated resources include every skill file and its hash. Each business operation remains independently exposed; there is no generic executor concealing operations from review.

The release build must compare skill references with the actual tool catalog, check schemas/annotations, and verify archive reproducibility. `tally mcp catalog --tool update_settings` inspects the bundled definition without account access; it cannot establish ChatGPT's imported or approved tool state.

## Missing-tool diagnosis

1. Verify the deployed catalog with the CLI and compare the installed ZIP version.
2. Inspect the host's imported tools and scan findings. An agent's initial tool context alone is inconclusive.
3. For a registered connection, refresh metadata and use a new conversation. For Platform submissions, inspect MCP Issues and request Rescan after a deployment.
4. Record the precise finding and affected tool. Keep compatibility with the live approved schema while a change is held.

Current missing `update_settings` report is unresolved in the uploaded host. Dependency corrections are a package improvement, not proof of causality.

## Required gates before requesting review

- Confirm publisher verification and authorized portal access
- Complete the portal-issued domain challenge without disturbing another plugin's challenge
- Confirm supported countries and commerce declarations; keep unknown manifest fields absent
- Verify all four listing pages (website, support, privacy policy and terms) are public and accurate
- Choose a support contact and publish an accurate privacy policy; document retention, subprocessors, logging and deletion behavior
- Provision a synthetic reviewer workspace and usable review login through secure setup
- Exercise consent, scope changes, refresh, revocation and account switching in the actual host; reconnect success is insufficient
- Audit all annotations against actual side effects, particularly sends, reminders, public sharing, resets and overwrites
- Audit government-ID/tax-ID fields, imported records and credential-related controls against restricted-data rules; no secret collection through model tool arguments
- Audit payment-control links and invoice-payment behavior against commerce restrictions; bookkeeping must not be represented as money execution
- Complete the scenarios below, record results and supply an accessible walkthrough
- Review the exact package, attestations and listing before submission; publisher chooses publication timing after approval

## Proposed positive scenarios (not yet certified)

1. Synthetic contractor onboarding: read settings, validate and apply approved Net 30/payment-instruction changes, create one client/project; read back exact values
2. Track synthetic work: add a manual entry, start/stop a timer and review unbilled totals without duplication
3. Prepare a draft: select a client's unbilled work, create and inspect an invoice; do not send or mark paid
4. Review finances: read invoices/expenses and produce an account-scoped summary with amounts consistent with records
5. Billing policy: validate and save an approved recurring draft template; explain actual runner/cutoff behavior, verify stored schedule and pause the test schedule

For each, capture the precise user prompt, expected tools, expected result and CLI evidence. Record the host walkthrough separately; automated tests do not establish host import correctness.

## Proposed negative scenarios (not yet certified)

1. Request another account's records: access denied without exposing records or identifiers
2. Request payment execution or submission of bank credentials through chat: explain supported bookkeeping scope and do not collect secrets or execute a transfer
3. Ambiguous destructive request: ask for exact scope and confirmation; preview where supported, make no destructive change without approval

## Current product gaps relevant to review

OAuth lifecycle reliability remains under investigation. Initial cloud latency still exceeds warm-request latency. Client-specific invoice defaults and previous-calendar-month recurring cutoffs remain pending. Recurring schedules currently reserve source entries at draft creation. The browser checks schedules on startup and periodically; saving a schedule does not provision an always-on server job. Keep all skill, guide and tool descriptions consistent with these limitations.

The development archive is not submission-ready: legal/support URLs, targeting, review metadata and the recorded demonstration remain incomplete. Version 0.3.4 synchronizes CLI/server/plugin identifiers, adds offline host tool-list comparison, and clarifies separate package, connection, and scan lifecycles. Hosted acceptance and OAuth lifecycle checks remain pending until actually exercised.

## 0.3.4 release evidence (in progress)

- Source catalog: 86 tools; host report: 76. The missing set has not been supplied, so no causal claim is made from counts alone.
- Offline catalog comparison implemented; it reports missing/unexpected/duplicate names without transmitting account data.
- Current SDK strips top-level OAuth descriptors by default. A public-handler catalog adapter now mirrors auth metadata at the descriptor top level; raw legacy and modern response tests pass. Scope enforcement remains in the existing call handlers.
- Local dual dependency installs caused modern HTTP tests to fail class-identity detection. Vite deduplication and a root ESM Next alias keep one server implementation. This local failure is not evidence of a production outage.
- Local checks: 683 web tests, 94 CLI tests, CLI typecheck, lint, installer rerun/checksum tests and production build passed before deployment. Packaged review cases are drafted, not certified as executed in ChatGPT.
- Live CLI access is blocked by the execution environment network policy. No live release verification or new OAuth grant is claimed.
- Known related public host reports: openai/codex #37313 and #43195. Different scopes; neither establishes Tallyhand's cause.

## Demo walkthrough to record after host verification

Use an isolated synthetic reviewer account, never the owner's HIPCO workspace. Show the installed version, OAuth consent, stable workspace identity, and the exact tool inventory. Ask to preview a business profile and Net 30 defaults; verify no mutation before approval. Approve the preview, then create a synthetic client/project, log one hour at $45, and prepare an unsent $45 draft. Show settings and invoice readback. Ask for a bank transfer to demonstrate the supported bookkeeping boundary without attempting one. Reconnect and read the same workspace again. Keep credentials and unrelated tabs off screen. A recording is not yet made or certified.
