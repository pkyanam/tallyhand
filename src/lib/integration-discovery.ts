/** Public discovery only: never include workspace data or credentials. */
import { oauthConfig } from "@/lib/auth/oauth";

export const DISCOVERY_HEADERS = {
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

export function integrationDiscovery() {
  const { origin, enabled, resource } = oauthConfig();
  const basis = { via: "declared", source: `${origin}/.well-known/integrations.json` };
  const bearer = { source: "http", in: "header", headerName: "Authorization", scheme: "Bearer" };
  const keyEntry = { use: [{ id: "tallyhand_api_key", mechanics: bearer }], basis };
  return {
    version: 3,
    summary: "Tallyhand provides time tracking, invoicing, expenses and contractor workspace management through a REST API, a Streamable HTTP MCP server, and the tally CLI. Install standalone CLI binaries from the setup guide; no npm package is published.",
    credentials: {
      tallyhand_api_key: {
        type: "api_key", label: "Tallyhand personal API key",
        generateUrl: `${origin}/settings/connect`,
        setup: `Sign in at ${origin}/settings/connect and create a personal API key. Send it in Authorization: Bearer. For the CLI, install from ${origin}/docs#cli, run tally config set api-url ${origin}, then tally login to paste the key into a hidden prompt. Alternatively set TALLYHAND_API_URL and TALLYHAND_API_TOKEN. The CLI stores login keys in ~/.tallyhand/config.json; protect this file. Hosted access covers the signed-in owner's cloud workspace, not browser-only offline data.`,
      },
      ...(enabled ? { tallyhand_oauth: {
        type: "oauth2", label: "Tallyhand delegated OAuth access",
        generateUrl: `${origin}/docs/integrations`,
        setup: `Discover the authorization server at ${origin}/.well-known/oauth-protected-resource/api/mcp. Use authorization code with S256 PKCE, consent and resource ${resource} in authorization and token requests. Request tally:read, adding tally:write or tally:manage for the actions needed; offline_access requests refresh tokens. Compatible clients can use client ID metadata documents; manual clients can be registered in Settings → Connect → OAuth applications. Send the resulting access token in Authorization: Bearer. Browser-session JWTs are not OAuth access tokens. The same resource-bound token authorizes scoped REST workspace operations; it cannot administer OAuth clients.`,
      } } : {}),
    },
    surfaces: [
      {
        slug: "tallyhand-api", name: "Tallyhand REST API", type: "http",
        url: `${origin}/api/v1`, spec: `${origin}/openapi.json`, docs: `${origin}/docs/integrations`, basis,
        auth: { status: "required", entries: [keyEntry, ...(enabled ? [{ use: [{ id: "tallyhand_oauth", mechanics: bearer }], basis }] : [])] },
        notes: "JSON envelopes, pagination, idempotent mutations and dry-run previews. OAuth access is limited to scoped workspace operations; credential and OAuth-client management requires browser sign-in.",
      },
      {
        slug: "tallyhand-mcp", name: "Tallyhand MCP server", type: "mcp",
        url: resource, transports: ["streamable-http"], docs: `${origin}/docs#mcp`, basis,
        auth: { status: "required", entries: [keyEntry, ...(enabled ? [{ use: [{ id: "tallyhand_oauth", mechanics: { source: "well-known" } }], basis }] : [])] },
        notes: "Stateless Streamable HTTP. No standalone GET stream or session IDs. Local stdio access is available through tally mcp after CLI configuration.",
      },
      {
        slug: "tallyhand-cli", name: "Tallyhand CLI", type: "cli", command: "tally",
        docs: `${origin}/docs#cli`, basis,
        auth: { status: "required", entries: [{ use: [{ id: "tallyhand_api_key", mechanics: { source: "cli", command: "tally login", env: ["TALLYHAND_API_TOKEN"] } }], basis }] },
        notes: `Standalone binaries, not an npm package. macOS/Linux installer: ${origin}/setup.sh (inspect before executing). Windows binaries: https://github.com/pkyanam/tallyhand/releases. Configure tally config set api-url ${origin} or TALLYHAND_API_URL. tally login prompts for a personal API key, not an OAuth browser login. tally --help discovers commands; --json returns structured output; tally mcp serves local stdio MCP.`,
      },
    ],
  };
}

export function mcpServerCard() {
  const { origin, enabled, issuer, resource } = oauthConfig();
  return {
    name: "Tallyhand", url: resource, transport: "streamable-http",
    documentationUrl: `${origin}/docs#mcp`,
    authentication: enabled ? { type: "oauth2", authorization_server: issuer } : { type: "bearer" },
  };
}

export function apiCatalog() {
  const { origin, resource } = oauthConfig();
  return { linkset: [
    { anchor: `${origin}/.well-known/api-catalog`, item: [{ href: `${origin}/api/v1` }, { href: resource }] },
    { anchor: `${origin}/api/v1`,
      "service-desc": [{ href: `${origin}/openapi.json`, type: "application/json" }],
      "service-doc": [{ href: `${origin}/docs/integrations`, type: "text/html" }],
    },
    { anchor: resource,
      "service-desc": [{ href: `${origin}/.well-known/mcp/server-card.json`, type: "application/json" }],
      "service-doc": [{ href: `${origin}/docs#mcp`, type: "text/html" }],
      "service-meta": [{ href: `${origin}/.well-known/oauth-protected-resource/api/mcp`, type: "application/json" }],
    },
  ] };
}
