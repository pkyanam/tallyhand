# Draft bug report: agent-plugin MCP tools silently hidden by an undocumented byte budget

**Product:** Codex CLI / Codex desktop (observed on codex-cli 0.160.0; behavior
present in 0.159.2 as well)
**Area:** MCP tool exposure for agent plugins (`codex-rs`
`core/src/mcp_tool_exposure.rs` and related)
**Severity:** high for plugin developers — tools disappear from the model with
no error, warning, or log on either side

## Summary

Codex exposes MCP tools from agent plugins to the model under a serialized
"model spec" byte budget: 8,000 bytes per tool and 64,000 bytes cumulative per
plugin (constants in `core/src/mcp_tool_exposure.rs` of codex-rs 0.160.0).
When a plugin's tool catalog overflows the cumulative budget, the tail of the
catalog — in the host's alphabetical tool order — is registered with
`ToolExposure::Hidden`: the tools are absent from the model's callable
registry and from tool search, but the `/mcp` panel still lists the full
catalog.

There is no warning, log line (at default levels), or user-visible signal at
any point. The plugin developer discovers the problem only when the model
"cannot find" a tool, and the `/mcp` count actively contradicts the registry.

## Reproduction shape

1. Publish an agent plugin whose MCP server advertises enough tools (or enough
   description/schema bytes) that the serialized specs exceed 64,000 bytes
   total. Note the server's `instructions` string is repeated in every tool's
   spec by the host, which multiplies quickly.
2. Connect Codex to it (stdio or streamable HTTP).
3. `/mcp` reports the full tool count; the model can neither see nor call the
   alphabetical tail of the catalog. An in-session registry scan confirms the
   missing names; exact-name tool search also returns nothing for them.

We reproduced this end-to-end on a clean machine profile with a fixture
serving a real 86-tool catalog: 76 tools exposed, 10 hidden, boundary
identical across two independent sessions.

## Impact

- Silent data-loss-like behavior for plugin users: a skill instructs the model
  to call a tool the host hid. The model then either refuses or improvises.
- `/mcp` shows a count that does not match what the model can call, which
  misleads debugging.
- No diagnostic exists to identify which tools were hidden or why.

## Requests

1. **Document the budget** (constants, ordering, and that it applies
   per-plugin to agent plugins) wherever MCP/agent-plugin limits are
   documented.
2. **Log a warning** when a tool is hidden by the budget, including the tool
   name and the plugin id, at default log level.
3. **Surface the discrepancy in `/mcp`**: e.g. show "86 tools (10 hidden by
   spec budget)".
4. Optionally: consider not counting the namespace description against every
   tool's spec, or deduplicating it, since the host itself multiplies it.

## Notes for triage

- The budget check runs regardless of the tool-search feature flag; overflow
  tools are `Hidden`, not `Deferred`, so tool search does not rescue them.
- Schema conversion also drops unknown JSON Schema keywords (format, minimum,
  maximum, pattern) before serialization, so measured sizes can differ from
  the server's advertised schemas.
- Our plugin reduced its serialized catalog to fit under the cap as a
  workaround; the underlying surprise behavior remains worth fixing for other
  plugin developers.
