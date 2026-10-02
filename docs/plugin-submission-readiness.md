# Tallyhand 0.3.7-rc.1 public-review preparation

Prepared October 2, 2026. Publisher selected by the owner: **Belweave**. Support: **info@belweave.com**. Currently free, no paid plans. Country targeting: no country restrictions requested, subject to platform availability and applicable law.

## What this candidate contains

- Same stable `tallyhand` package identity and remote MCP endpoint; no replacement private plugin or account binding
- Root portable manifest plus a conservative Codex compatibility overlay
- Original 512-pixel PNG listing/composer logo and skill-local 192-pixel PNG icons in all five skills
- Explicit onboarding skill, five positive and three negative review scenarios
- Website, support, privacy and terms URL declarations
- Worldwide targeting intent, release notes and truthful no-commerce declaration
- Skills prohibit credential/government-ID collection and explain draft, send, sharing and deletion boundaries

Canonical review metadata is in root `plugin.json` under `extensions.com.openai`. Some older local Codex validators reject newer portal fields in the compatibility overlay; those declarations remain in the canonical root, which takes precedence in current OpenAI import behavior.

The existing stable distribution remains 0.3.6. The separate candidate ZIP is `public/plugins/tallyhand-0.3.7-rc.1.zip`; its sources are in `releases/plugin-0.3.7-rc.1/`. Do not install or update a user's private entry without their request.

## Working discovery fix is preserved

The October 1 diagnosis is resolved: Codex 0.160.x has an agent-plugin tool-spec byte budget, and repeats server instructions in each tool. The compact catalog and byte-budget regression test remain in place. All 86 tools, including all 12 update tools, remain advertised. The owner confirmed working ChatGPT access after manually updating the plugin skill. This does not certify every OAuth lifecycle or every review case.

## MCP privacy boundary

MCP uses a data-minimization facade; the ordinary app, REST and direct CLI keep their existing behavior. Structured government-ID, bank-account and credential fields are omitted from MCP results and blocked in MCP inputs. The settings schema does not advertise tax-ID entry. A backup containing restricted fields is blocked rather than returning a lossy backup; users must export the complete backup through the secure web interface. Free-text attachments are not a general-purpose DLP system. Users must not submit restricted data through agents.

## Verification evidence

- Local catalog: 86 tools; every tool declares boolean read-only, destructive and open-world annotations
- Legacy/modern transport and byte-budget regression suite passes
- Public page paths have middleware tests under Clerk, builtin and no-auth modes
- CLI tests include MCP-only redaction, write blocking, preservation of normal API data and refusal of lossy backups
- Local package validation checks the compatibility manifest and skill assets
- Final release notes must record final CI/deployment status and URL verification separately

## Remaining submission gates — do not claim approved or fully ready

1. Verify the deployed public pages and candidate ZIP after CI/deployment
2. Make and verify a real host walkthrough of this version using synthetic data; the promotional launch film is illustrated and is NOT review evidence
3. Provide a dedicated reviewer account in the portal's secure access fields; never add credentials to source, ZIP or public issue
4. Run the five positive and three negative cases in the actual host. They are drafted, not certified as run. Existing unit tests are not a substitute
5. In the intended verified Belweave publisher organization: upload the candidate as a draft, complete the domain challenge, connect OAuth, finish tool/skill scans and inspect all imported metadata
6. Have the authorized publisher complete attestations and request review. Public publication is a later, separate step after approval

The hosted privacy/terms text is owner-approved product policy, not an independent legal-compliance opinion. Worldwide availability does not establish compliance with every jurisdiction. Provider backup/account retention configuration and any required additional regional disclosures should be confirmed for the final privacy review.

## Demo recording plan

Use a dedicated synthetic account, not an actual contractor workspace. Show the package version and OAuth connection without displaying secrets. Preview a business profile and Net 30 settings; verify no change before approval. Apply only after explicit approval. Create Example Client and Demo Labor at $45/hour, log 60 minutes, then prepare an unsent $45 draft with zero tax. Read the draft and show consistent totals. Ask for a money transfer and demonstrate that the plugin does not execute it. Show successful read access after reconnecting. Include readable prompts and actual tool results. Do not simulate or narrate a success that was not observed.

Host the recording at an owner-approved reviewer-accessible URL, verify playback, add `review.demo_recording_url`, then rebuild the final ZIP. Do not use a private video link that reviewers cannot open.

## Official references checked

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/plugin-guidelines
