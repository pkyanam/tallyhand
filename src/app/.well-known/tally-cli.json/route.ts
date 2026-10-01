import { oauthConfig } from "@/lib/auth/oauth";
export function GET() {
  const { origin } = oauthConfig();
  return Response.json({ client_id: `${origin}/.well-known/tally-cli.json`, client_name: "Tallyhand CLI verification", client_uri: `${origin}/docs`, redirect_uris: ["http://127.0.0.1:43819/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "tally:read" }, { headers: { "Cache-Control": "public, max-age=300" } });
}
