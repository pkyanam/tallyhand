# Tallyhand MCP

Tallyhand exposes the **same workspace API and authenticated owner** through its CLI and MCP server. Both transports use `TallyhandClient`; validation, roles, revision checks, idempotency and database isolation remain in `/api/v1`.

## Protocol and transports

- Official TypeScript SDK v2.2, implementing MCP **2026-07-28**
- `tally mcp`: stdio, with environment/file configuration kept local
- `https://tallyhand.xyz/api/mcp`: Streamable HTTP
- Modern `server/discover`, per-request metadata/capabilities, result types, required metadata headers, private cache hints and JSON/SSE response handling
- Legacy 2025 initialization clients remain supported through the SDK's stateless compatibility layer
- No standalone GET stream or protocol session IDs; authenticated GET/DELETE return 405
- Origin allowlist and bounded request bodies; loopback API destination comes from trusted deployment configuration, never the incoming Host header
- Workspace resource responses are private with zero cache TTL

## Workspace capabilities

91 tools cover all CLI business operations, including JSON/CSV export and atomic cloud backup/import/reset. `tally://capabilities/cli-parity` contains the maintained command-to-tool map. CI fails when a new CLI leaf lacks either a tool mapping or an explicit local-only classification.

Local file paths, storing credentials, spawning the server and CLI health benchmarks are not remote workspace operations. MCP exports return content for the client to save. MCP discovery/authentication provide the corresponding connection controls without exposing configuration secrets as tools.

Additional protocol-native capabilities:

- Machine-readable structured results and output schemas
- Read/write/destructive/idempotence annotations (hints, never authorization)
- Resources: agent guide, CLI parity and current workspace settings
- URI templates for clients, projects, tasks, expenses and invoices
- Prompts: weekly review, invoice preparation and workspace reconciliation
- Client-ID prompt argument completion
- Multi-round-trip form elicitation when export selection is omitted; declined forms do not export
- Cancellation checks and request abort propagation to the shared API client

Catalogs are static for a deployed release. Cross-user live resource subscriptions are not advertised. Durable Tasks, Skills and MCP Apps are optional extensions and are not advertised by this release. It does not add deprecated sampling, roots or logging mechanisms. No fake capability declarations are used.

## Authentication

### API keys

Use `Authorization: Bearer <Tallyhand personal API key>`. Keys retain their owner's normal application role. Never put tokens in URLs, prompts, tool arguments or repository files.

### Clerk OAuth

Production activation requires Clerk configuration and the following server environment variables:

- `APP_BASE_URL=https://tallyhand.xyz`
- `TALLY_OAUTH_ISSUER=https://clerk.tallyhand.xyz`
- `TALLY_MCP_OAUTH_ENABLED=true`
- Existing `CLERK_SECRET_KEY` remains server-only

Enable Clerk **Publish CIMD support**, permit appropriate clients, require **S256 PKCE**, retain the consent screen, and enable **Include Audience**. The client must request resource `https://tallyhand.xyz/api/mcp` in authorization/token requests. Tokens missing that exact audience are rejected. Pre-registered OAuth clients are also supported. Deprecated DCR is not enabled by the application.

Create/assign these Clerk custom scopes:

- `tally:read`: inspect workspace tools/resources
- `tally:write`: create or edit workspace records
- `tally:manage`: delete, import/reset, mark invoices sent/paid

Use `tally:read` as the default dynamic-client scope. Additional actions produce scope challenges. A user's application role still restricts all writes. OAuth grants do not authorize administration, credential creation or browser sign-in. Ordinary Clerk session/ID tokens are not accepted as MCP OAuth access tokens.

Discovery is at `/.well-known/oauth-protected-resource/api/mcp` (also available at the root metadata path). An unauthenticated request returns an RFC 9728 resource-metadata challenge. The metadata points to Clerk's own issuer rather than impersonating the authorization server. Clerk owns authorization codes, PKCE, consent and refresh tokens. Tokens are verified using Clerk Backend SDK with explicit audience checking and revocation/expiry checks.

OAuth remains disabled until the explicit environment switch and issuer are configured. Do not claim live OAuth works solely because bearer-key or discovery tests pass.

## Verification through the CLI

Install/update: `curl -fsSL https://tallyhand.xyz/setup.sh | bash`. The script preserves saved CLI configuration. See [the setup guide](https://tallyhand.xyz/docs). `tally setup-check` verifies public documentation and OAuth discovery. `tally mcp oauth-check` starts a real, read-only consent flow with a loopback callback and runs authenticated MCP checks; its tokens stay in memory.

- `tally mcp check --transport stdio --protocol modern --workspace`
- `tally mcp check --transport stdio --protocol legacy --workspace`
- `tally mcp check --transport http --protocol modern --workspace`
- `tally mcp check --transport http --protocol legacy --workspace`

Checks are read-only and use the saved CLI credentials. Actual OAuth consent/token acquisition requires a separate end-to-end OAuth client check; API-key results are not proof of OAuth readiness.

Reset/import tools require an exported backup revision, an exact confirmation phrase, and acknowledgement that the client saved the backup. The server checks the revision atomically. Hosts must obtain explicit approval before consequential actions; annotations do not substitute for approval.

## Sources

- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://ts.sdk.modelcontextprotocol.io/v2/
- https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
- https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens

### Permission upgrades in ChatGPT

Every tool publishes its OAuth scopes in top-level `securitySchemes` and the matching `_meta.securitySchemes` compatibility mirror. Raw legacy and modern HTTP tests verify both; parsed client SDK results may discard fields unknown to that SDK. Write/manage requests include the base `tally:read` scope so reauthorization does not lose read access. Modern MCP clients receive HTTP `403 insufficient_scope`; legacy clients receive an error tool result with `_meta["mcp/www_authenticate"]` so ChatGPT can show a consent prompt rather than treating a valid read-only connection as expired. Neither response executes the action.

The Clerk application's allowed scopes must also permit the client to request the additional permissions. An existing read-only client record may need its allowed scopes updated by the instance administrator; the user must then approve the new grant. Do not bypass these checks or broaden defaults to hide a connection problem.
