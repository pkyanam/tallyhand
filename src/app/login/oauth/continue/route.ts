import { oauthConfig } from "@/lib/auth/oauth";
import { OAuthContinuationError, validateOAuthContinuation } from "./validation";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const config = oauthConfig();
  if (!config.enabled || !config.issuer) return Response.json({ error: "OAuth continuation is unavailable. Restart CLI login." }, { status: 503, headers });
  try {
    let issuer: URL;
    try { issuer = new URL(config.issuer); } catch { throw new OAuthContinuationError("issuer_configuration"); }
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || !["", "/"].includes(issuer.pathname)) throw new OAuthContinuationError("issuer_configuration");
    // This application uses Clerk's authorization server. Pin its canonical endpoint;
    // CLI discovery already verifies issuer metadata before creating this request.
    const authorizationEndpoint = new URL("/oauth/authorize", issuer).toString();
    const params = new URL(req.url).searchParams;
    if (params.getAll("authorization_url").length !== 1) throw new OAuthContinuationError("continuation_parameter_count");
    const destination = validateOAuthContinuation(params.get("authorization_url")!, config.origin, config.issuer, authorizationEndpoint);
    return new Response(null, { status: 302, headers: { ...headers, Location: destination } });
  } catch (error) { return Response.json({ error: "Invalid OAuth continuation. Restart CLI login.", code: error instanceof OAuthContinuationError ? error.code : "continuation_internal" }, { status: 400, headers }); }
}
