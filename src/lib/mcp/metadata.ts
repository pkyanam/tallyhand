import { oauthConfig } from "@/lib/auth/oauth";
export function protectedResourceMetadata(): Response {
  const config = oauthConfig();
  return Response.json({ resource: config.resource, resource_name: "Tallyhand contractor finance",
    ...(config.enabled ? { authorization_servers: [config.issuer] } : {}),
    scopes_supported: ["tally:read"], bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/pkyanam/tallyhand",
  }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
export function metadataOptions(): Response {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
