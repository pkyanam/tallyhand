"use client";

import { useSignIn } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Clerk's v5 widget does not list AgentID yet, but its redirect API supports it. */
export function AgentIdSignInButton({ redirectUrlComplete }: { redirectUrlComplete: string }) {
  const { isLoaded, signIn } = useSignIn();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // Callback and MFA subroutes remain owned by Clerk's existing widget.
  if (pathname !== "/login") return null;

  async function startSignIn() {
    if (!signIn || pending) return;
    setPending(true);
    setError(false);
    try {
      await signIn.authenticateWithRedirect({
        // AgentID launched after this SDK's OAuthStrategy type was released.
        strategy: "oauth_agentid" as Parameters<typeof signIn.authenticateWithRedirect>[0]["strategy"],
        redirectUrl: "/login/sso-callback",
        redirectUrlComplete,
      });
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return <div className="w-full max-w-sm text-center">
    <Button type="button" variant="outline" className="w-full" disabled={!isLoaded || pending} onClick={startSignIn}>
      {pending ? "Connecting to AgentID…" : "Continue with AgentID"}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">Unable to start AgentID sign-in. Please try again.</p>}
  </div>;
}
