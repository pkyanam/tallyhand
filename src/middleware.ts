/**
 * Route protection, driven by the effective `TALLY_AUTH` (see
 * `effectiveAuth()` in `src/lib/mode.ts` — explicit TALLY_AUTH wins,
 * otherwise Clerk keys auto-detect `clerk`):
 *
 * - `clerk`   → Clerk middleware protects the app + API surface (except the
 *   public exceptions below). @clerk/nextjs is imported dynamically so the
 *   module never loads in local/none mode. Unauthenticated API requests get
 *   a 401 JSON error envelope; `/api/v1/openapi.json` is public. Two pass-throughs:
 *     · any `Authorization: Bearer …` request — the route's
 *       requireApiToken() verifies it (shared env token or personal
 *       `thp_…` token), so machine clients never need a Clerk session;
 *     · the `tallyhand_local` cookie (set by the landing page's "Use
 *       locally" choice) — app routes only, never API routes. The browser
 *       app is local-first (Dexie), so these users get zero-cloud behavior
 *       without signing in.
 * - `builtin` → session-cookie check on browser routes (redirect to
 *   /login); any Bearer <redacted> passes through and API routes verify
 *   the session/token themselves via resolveUserId().
 * - `none`    → single-user local: everything passes through.
 *
 * Public (never gated): landing page, login page, builtin auth endpoints,
 * Clerk's own /sign-in catch-alls (if used), public share pages + their
 * resolution/approval/payment APIs, and the legacy local invoice-public route.
 */
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { effectiveAuth } from "@/lib/mode";
import { LOCAL_CHOICE_COOKIE } from "@/lib/landing";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/docs(\/.*)?$/,
  /^\/(privacy|terms|support)\/?$/,
  /^\/(?:installer\/)?setup\.sh$/,
  /^\/llms\.txt$/,
  /^\/(?:SKILL\.md|robots\.txt|sitemap\.xml)$/,
  /^\/openapi\.(?:json|yaml)$/,
  /^\/\.well-known\//,
  /^\/login(\/.*)?$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/share(\/.*)?$/,
  /^\/api\/share\/(resolve|approve|pay)(\/.*)?$/,
  /^\/api\/auth(\/.*)?$/,
  // Public liveness/configuration probes never return workspace data.
  /^\/api\/(?:v1\/)?health$/,
  // The spec documents itself as requiring no authentication.
  /^\/api\/v1\/openapi\.json$/,
  /^\/invoice\/public(\/.*)?$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function hasBearer(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  return /^Bearer\s+.+/i.test(header.trim());
}

/** Edge-safe discovery only; credential verification remains in the API handlers. */
function apiOAuthChallengeHeaders(pathname: string): Record<string, string> | undefined {
  if (!pathname.startsWith("/api/v1/") || process.env.TALLY_MCP_OAUTH_ENABLED !== "true" || !process.env.TALLY_OAUTH_ISSUER) return;
  try {
    // Match oauthConfig's configured origin; never derive metadata from an
    // untrusted request Host header or import the Node-only OAuth verifier.
    const base = new URL(process.env.APP_BASE_URL ?? process.env.TALLYHAND_APP_URL ?? "http://localhost:3000");
    if (base.protocol !== "https:" && base.protocol !== "http:") return;
    return {
      "WWW-Authenticate": `Bearer resource_metadata="${base.origin}/.well-known/oauth-protected-resource/api/mcp", scope="tally:read"`,
      "Cache-Control": "no-store",
    };
  } catch { return; }
}

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const authMode = effectiveAuth({
    TALLY_AUTH: process.env.TALLY_AUTH,
    CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  });
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    // Public auth pages still need Clerk's request context. Skipping the
    // middleware makes server auth() throw even with a valid browser session.
    if (authMode === "clerk" && (pathname === "/" || /^\/(login|sign-in|sign-up)(\/|$)/.test(pathname))) {
      const mod = await import("@clerk/nextjs/server");
      return mod.clerkMiddleware(() => {})(req, event);
    }
    return NextResponse.next();
  }
  // MCP owns its OAuth/API-key gate and challenges; browser-session middleware
  // must not replace them with a Clerk-session handshake. No data is served here.
  if (pathname === "/api/mcp") return NextResponse.next();
  // OAuth grants cover workspace APIs/MCP, never admin or browser sessions.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if ((bearer.startsWith("oat_") || /^ey[^.]+\.[^.]+\.[^.]+$/.test(bearer)) &&
      !pathname.startsWith("/api/v1/") && pathname !== "/api/mcp") {
    return NextResponse.json({ error: { code: "forbidden", message: "OAuth tokens authorize workspace API requests only" } }, { status: 403 });
  }

  // Workspace bearer routes validate credentials and scopes themselves. Avoid
  // invoking browser-session machinery before those authenticated API handlers.
  if (pathname.startsWith("/api/v1/") && hasBearer(req)) return NextResponse.next();

  if (authMode === "clerk") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (await import("@clerk/nextjs/server")) as typeof import(
      "@clerk/nextjs/server"
    );
    const isProtected = mod.createRouteMatcher([
      "/dashboard(.*)",
      "/ledger(.*)",
      "/clients(.*)",
      "/projects(.*)",
      "/timesheet(.*)",
      "/analytics(.*)",
      "/tax(.*)",
      "/invoices(.*)",
      "/expenses(.*)",
      "/reckoning(.*)",
      "/settings(.*)",
      "/admin(.*)",
      "/api/v1(.*)",
      "/api/admin(.*)",
      "/api/share/links(.*)",
    ]);
    return mod.clerkMiddleware(async (auth, request) => {
      if (!isProtected(request)) return;
      // Machine/API access: the route verifies the bearer token itself.
      if (hasBearer(request)) return;
      // "Use locally" landing choice: app routes only, never API routes.
      if (
        !isApiRoute(request.nextUrl.pathname) &&
        request.cookies.get(LOCAL_CHOICE_COOKIE)?.value === "1"
      ) {
        return;
      }
      const { userId } = await auth();
      if (userId) return;
      // Unauthenticated API call: answer with the app's JSON error envelope
      // (401), not Clerk's 404 HTML page. Page routes keep Clerk's
      // redirect-to-sign-in behavior below.
      if (isApiRoute(request.nextUrl.pathname)) {
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Not signed in" } },
          { status: 401, headers: apiOAuthChallengeHeaders(request.nextUrl.pathname) },
        );
      }
      await auth.protect();
    })(req, event);
  }

  if (authMode === "builtin") {
    const session = req.cookies.get("tally_session")?.value;
    // Any bearer token passes middleware; the route verifies it
    // (shared env token or personal thp_… token) via resolveUserId().
    if (session || hasBearer(req)) return NextResponse.next();
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: apiOAuthChallengeHeaders(pathname) });
    }
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // none: single-user local — pass through.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
