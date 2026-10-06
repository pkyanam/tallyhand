import { oauthConfig } from "@/lib/auth/oauth";
import { validateOAuthContinuation } from "./validation";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const config = oauthConfig();
  if (!config.enabled || !config.issuer) return Response.json({ error: "OAuth continuation is unavailable. Restart CLI login." }, { status: 503, headers });
  try {
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || !["", "/"].includes(issuer.pathname)) throw new Error();
    // This application uses Clerk's authorization server. Pin its canonical endpoint;
    // CLI discovery already verifies issuer metadata before creating this request.
    const authorizationEndpoint = new URL("/oauth/authorize", issuer).toString();
    const params = new URL(req.url).searchParams;
    if (params.getAll("authorization_url").length !== 1) throw new Error();
    const destination = validateOAuthContinuation(params.get("authorization_url")!, config.origin, config.issuer, authorizationEndpoint);
    return new Response(null, { status: 302, headers: { ...headers, Location: destination } });
  } catch { return Response.json({ error: "Invalid OAuth continuation. Restart CLI login." }, { status: 400, headers }); }
}
