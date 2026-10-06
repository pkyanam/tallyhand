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
    const encoded = params.getAll("authorization_url_b64"), legacy = params.getAll("authorization_url");
    if (encoded.length + legacy.length !== 1) throw new OAuthContinuationError("continuation_parameter_count");
    let authorizationUrl: string;
    if (encoded.length) {
      if (!/^[A-Za-z0-9_-]{1,16384}$/.test(encoded[0])) throw new OAuthContinuationError("continuation_encoding");
      const bytes = Buffer.from(encoded[0], "base64url");
      if (bytes.toString("base64url") !== encoded[0]) throw new OAuthContinuationError("continuation_encoding");
      authorizationUrl = bytes.toString("utf8");
    } else {
      authorizationUrl = legacy[0];
      // Next 14 normalizes a literal loopback address even inside an encoded
      // nested query. Repair only the released CLI's exact registered callback.
      try {
        const parsed = new URL(authorizationUrl);
        if (parsed.searchParams.getAll("redirect_uri").length === 1 && parsed.searchParams.get("redirect_uri") === "http://localhost:43819/callback") {
          parsed.searchParams.set("redirect_uri", "http://127.0.0.1:43819/callback");
          authorizationUrl = parsed.toString();
        }
      } catch { throw new OAuthContinuationError("url_parse"); }
    }
    const destination = validateOAuthContinuation(authorizationUrl, config.origin, config.issuer, authorizationEndpoint);
    return new Response(null, { status: 302, headers: { ...headers, Location: destination } });
  } catch (error) { return Response.json({ error: "Invalid OAuth continuation. Restart CLI login.", code: error instanceof OAuthContinuationError ? error.code : "continuation_internal" }, { status: 400, headers }); }
}
