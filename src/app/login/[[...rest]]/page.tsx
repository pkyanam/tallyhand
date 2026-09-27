/**
 * /login — auth entry point (server component).
 *
 * This is an optional catch-all ([[...rest]]) so Clerk's <SignIn>/<SignUp>
 * handle their own sub-paths here: /login/sso-callback (OAuth return),
 * /login/factor-one (MFA), etc. Without the catch-all, Google sign-in
 * bounces to /login/sso-callback and Next.js returns a 404.
 *
 * Renders per TALLY_AUTH:
 * - clerk   → Clerk's hosted SignIn component (?mode=sign-up → SignUp).
 * - builtin → email magic-link form (no password to remember).
 * - none    → explains auth is disabled (single-user local mode).
 */
import { effectiveAuth } from "@/lib/mode";
import { BuiltinLoginForm } from "../builtin-login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  const auth = effectiveAuth();
  const { next, mode } = await searchParams;

  if (auth === "clerk") {
    // ?mode=sign-up renders the registration form; default is sign-in.
    // Clerk's <SignIn> also links to sign-up on its own.
    const { SignIn, SignUp } = await import("@clerk/nextjs");
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        {mode === "sign-up" ? (
          <SignUp forceRedirectUrl={next ?? "/"} />
        ) : (
          <SignIn forceRedirectUrl={next ?? "/"} />
        )}
      </main>
    );
  }

  if (auth === "builtin") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <BuiltinLoginForm />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">No login needed</h1>
        <p className="text-sm text-muted-foreground">
          Tallyhand is running in single-user local mode (TALLY_AUTH=none). Just open the
          app — there are no accounts here.
        </p>
        <a href="/" className="text-sm underline underline-offset-4">
          Go to the dashboard
        </a>
      </div>
    </main>
  );
}
