# Tallyhand agent integrations

`tallyhand/` is the shared plugin source. Its root `plugin.json`, `mcp.json`,
skills, and artwork are portable Agent Plugins content. Codex compatibility
lives in `.codex-plugin/plugin.json`, `.mcp.json`, and skill `agents/openai.yaml`
files. Other harness adapters can be added alongside these without renaming
Tallyhand, changing the MCP service, or duplicating its business logic.

## Install in Codex CLI

```sh
codex plugin marketplace add pkyanam/tallyhand
codex plugin add tallyhand@tallyhand
codex
```

Review and complete the OAuth prompt when offered. Start a fresh Codex session
after installation. First ask it to list the available Tallyhand tool names and
find `get_settings` and `update_settings` without executing account changes.
Then request `get_settings`. Only after that, request a settings update with
`dryRun: true`; review the preview before authorizing an actual write.

The remote MCP endpoint always uses the currently deployed service. Installing
a particular package version pins skills and metadata, not hosted server code.
An installed package alone does not establish that OAuth or every tool works.

## Update and remove

```sh
codex plugin marketplace upgrade tallyhand
codex plugin add tallyhand@tallyhand
```

Start a new session after updating. To uninstall the local copy:

```sh
codex plugin remove tallyhand@tallyhand
```

If the marketplace is no longer wanted, separately run
`codex plugin marketplace remove tallyhand`. These CLI operations do not delete
a separately created private ChatGPT plugin listing. Do not delete local
configuration or credentials manually to troubleshoot an installation.

## Distribution architecture

- `.agents/plugins/marketplace.json`: Codex Git/local marketplace adapter
- `public/plugins/catalog.json`: Tallyhand-owned, harness-neutral distribution
  index with versioned archive and SHA-256; not a universal marketplace standard
- `public/plugins/tallyhand-<version>.zip`: immutable, self-contained package
- `/plugins/tallyhand.zip`: convenience link to the current package
- `/api/mcp`: shared authenticated application operations

Codex's marketplace command accepts a Git repository or local marketplace root,
not the website catalog URL. ChatGPT's public-directory publication has a
separate review/submission process; adding this repository catalog does not
publish a public listing. Other harnesses are not advertised as tested until
their adapters, authentication and workflows are verified.

## Build and verify

```sh
node scripts/build-agent-skills.mjs
python3 scripts/package-agent-plugin.py
node scripts/build-plugin-marketplace.mjs
```

Use `--check` with each command in CI. The portable manifest is the version and
identity source; generated marketplace/catalog files are never edited manually.
Preserve old versioned archives. Never include credentials in any package,
manifest, URL or marketplace file.
