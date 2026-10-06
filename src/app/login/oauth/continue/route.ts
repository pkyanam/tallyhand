import { oauthConfig } from "@/lib/auth/oauth";
import { validateOAuthContinuation } from "./validation";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    const config = oauthConfig();
    if (!config.enabled || !config.issuer) throw new Error();
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error();
    const response = await fetch(`${config.issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) throw new Error();
    const metadata = await response.json();
    if (metadata.issuer !== config.issuer) throw new Error();
    const params = new URL(req.url).searchParams;
    if (params.getAll("authorization_url").length !== 1) throw new Error();
    const destination = validateOAuthContinuation(params.get("authorization_url")!, config.origin, config.issuer, metadata.authorization_endpoint);
    return new Response(null, { status: 302, headers: { ...headers, Location: destination } });
  } catch { return Response.json({ error: "Invalid or unavailable OAuth continuation. Restart CLI login." }, { status: 400, headers }); }
}
