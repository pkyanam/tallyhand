# TODOS

## Sales and payments

### Tallyhand-initiated refunds — Release 2

**What:** Add authorized refund commands through Tallyhand's UI and agent/API surfaces after the first reliable-collections release.

**Why:** Keep the first release focused on collecting invoice payments and accurate financial history while retaining complete Agora feature absorption.

**Pros:** Reduces outgoing-provider mutations and operational paths in Release 1; lets refund initiation land alongside the fuller workspace/agent controls.

**Cons:** Owners temporarily initiate refunds through the provider; postponing commands does not remove the eventual implementation or regression work.

**Context:** Approved in the CEO scope review on 2026-10-08, D7 / REDUCE-1, user answer “Defer to TODOS.md.” This amends the previously approved design's Release 1 refund timing, not its final feature set. Release 1 must still ingest/reconcile provider-originated refunds, display pending/failed/confirmed outcomes and preserve correct partial/full balances with replay/concurrency/account/mode tests. The present Stripe webhook handles only checkout completion; these retained safeguards require new work. Reuse Agora's `lib/server/service.ts` refund rules and `stripe-runtime.ts` adapter behavior, adapting them to Tallyhand's async multi-backend, workspace-authorized domain. Initiation must preserve reservations, stable provider idempotency, unknown-outcome reconciliation, permission checks and directly required regressions. Later agent allowances/approvals keep their existing Release 2 timing. See `docs/designs/tallyhand-agora-shared-core.md` and the source/review analysis in `/Users/preetham/Code/agora/tallyhand-integration-analysis.md`. The legacy `TODO.md` is unchanged.

**Effort:** Human-team M / Codex+gstack S (rough estimate for refund initiation, not the entire financial core)
**Priority:** P2
**Depends on:** Shared financial core, supported provider connection, verified refund ingestion/reconciliation and financial permissions; full control release for governed agent execution.
