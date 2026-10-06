import { oauthConfig } from "@/lib/auth/oauth";
export function GET() {
  const { origin } = oauthConfig();
  return Response.json({ client_id: `${origin}/.well-known/tally-cli.json`, client_name: "Tallyhand CLI", client_uri: `${origin}/docs`, redirect_uris: ["http://127.0.0.1:43819/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "tally:read tally:write tally:manage offline_access" }, { headers: { "Cache-Control": "public, max-age=300" } });
}
