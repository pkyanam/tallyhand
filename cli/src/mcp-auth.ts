/** OAuth permissions stay enforced; legacy hosts get a tool-level consent prompt. */
import { requireScopes, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
export interface McpAuthOptions { oauth?: boolean; legacyOAuth?: boolean }
export function toolScopes(scope: string): [string, ...string[]] { return scope === "tally:read" ? [scope] : ["tally:read", scope]; }
export function toolAuthPolicy(options: McpAuthOptions, scope: string) {
  const scopes = toolScopes(scope);
  return {
    _meta: { securitySchemes: [{ type: "oauth2", scopes }] },
    scopeChallenge: options.oauth && !options.legacyOAuth ? requireScopes(...scopes) : undefined,
  };
}
export function toolAuthError(options: McpAuthOptions, scope: string, ctx: ServerContext): CallToolResult | undefined {
  if (!options.oauth) return;
  const auth = ctx.http?.authInfo;
  const required = toolScopes(scope);
  if (auth && required.every(item => auth.scopes.includes(item))) return;
  const metadataUrl = auth?.resourceMetadataUrl;
  if (!metadataUrl) throw new Error("OAuth resource metadata is unavailable");
  return {
    isError: true,
    content: [{ type: "text", text: "Your connection is valid, but this action needs additional permission. Approve the requested access, then retry. No data was changed." }],
    _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${metadataUrl}", scope="${required.join(" ")}", error="insufficient_scope", error_description="Approve the requested Tallyhand permissions to continue"`] },
  };
}
