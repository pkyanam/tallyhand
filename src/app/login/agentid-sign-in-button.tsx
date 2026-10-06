"use client";

import { useSignIn } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import Image from "next/image";

/** Clerk's widget does not list AgentID yet, but its redirect API supports it. */
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
        redirectUrl: `/login/sso-callback?next=${encodeURIComponent(redirectUrlComplete)}`,
        redirectUrlComplete,
      });
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return <div className="w-full text-center">
    <Button type="button" variant="outline" className="h-12 w-full gap-3 rounded-md border-input bg-background text-sm font-medium shadow-sm" disabled={!isLoaded || pending} onClick={startSignIn}>
      <Image src="/brand/agentid-black.svg" alt="" width={24} height={24} className="dark:hidden" />
      <Image src="/brand/agentid-white.svg" alt="" width={24} height={24} className="hidden dark:block" />
      {pending ? "Connecting to AgentID…" : "Continue with AgentID"}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">Unable to start AgentID sign-in. Please try again.</p>}
  </div>;
}
