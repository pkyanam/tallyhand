/**
 * /login — auth entry point (server component).
 *
 * Renders per TALLY_AUTH:
 * - clerk   → Clerk's hosted SignIn component.
 * - builtin → email magic-link form (no password to remember).
 * - none    → explains auth is disabled (single-user local mode).
 */
import { parseAuth } from "@/lib/mode";
import { BuiltinLoginForm } from "./builtin-login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const auth = parseAuth();
  const { next } = await searchParams;

  if (auth === "clerk") {
    const { SignIn } = await import("@clerk/nextjs");
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <SignIn forceRedirectUrl={next ?? "/"} />
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
