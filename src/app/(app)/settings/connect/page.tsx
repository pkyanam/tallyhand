/**
 * /settings/connect — API tokens + integration docs for the signed-in user.
 *
 * Hidden/disabled when TALLY_AUTH=none (no signed-in users exist there).
 * (The existing /settings page itself is untouched by this track.)
 */
import { effectiveAuth } from "@/lib/mode";
import { ConnectClient } from "./connect-client";

export default function SettingsConnectPage() {
  if (effectiveAuth() === "none") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Connect</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          API tokens are disabled in single-user local mode
          (TALLY_AUTH=none). Configure TALLY_AUTH=clerk or TALLY_AUTH=builtin
          to create personal API tokens.
        </p>
      </main>
    );
  }
  return <ConnectClient />;
}
