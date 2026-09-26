/**
 * Route protection, driven by `TALLY_AUTH`:
 *
 * - `clerk`   → Clerk middleware protects the app + API surface (except the
 *   public exceptions below). @clerk/nextjs is imported dynamically so the
 *   module never loads in local/none mode.
 * - `builtin` → session-cookie check on browser routes (redirect to
 *   /login); API routes verify the session/token themselves via
 *   resolveUserId().
 * - `none`    → single-user local: everything passes through.
 *
 * Public (never gated): landing page, login page, builtin auth endpoints,
 * Clerk's own /sign-in catch-alls (if used), public share pages + their
 * resolution/approval/payment APIs, and the legacy local invoice-public route.
 */
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/login(\/.*)?$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/share(\/.*)?$/,
  /^\/api\/share\/(resolve|approve|pay)(\/.*)?$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/invoice\/public(\/.*)?$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const authMode = (process.env.TALLY_AUTH ?? "none").trim().toLowerCase();
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (authMode === "clerk") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (await import("@clerk/nextjs/server")) as typeof import(
      "@clerk/nextjs/server"
    );
    const isProtected = mod.createRouteMatcher([
      "/dashboard(.*)",
      "/ledger(.*)",
      "/clients(.*)",
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
      if (isProtected(request)) await auth.protect();
    })(req, event);
  }

  if (authMode === "builtin") {
    const session = req.cookies.get("tally_session")?.value;
    const cliToken =
      process.env.TALLYHAND_API_TOKEN &&
      req.headers.get("authorization") === `Bearer ${process.env.TALLYHAND_API_TOKEN}`;
    if (session || cliToken) return NextResponse.next();
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
