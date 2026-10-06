"use client";
import { useSignIn, useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { writeLandingChoice } from "@/app/landing-choice";
export function AgentIdEntry({ next }: { next: string }) {
  const { isLoaded, signIn } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const started = useRef(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isLoaded || !authLoaded || started.current) return;
    started.current = true;
    if (isSignedIn) { writeLandingChoice("cloud"); window.location.assign(next); return; }
    if (!signIn) { setFailed(true); return; }
    // This explicit sign-in entry selects the cloud workspace before navigating.
    writeLandingChoice("cloud");
    void signIn.authenticateWithRedirect({ strategy: "oauth_agentid" as Parameters<typeof signIn.authenticateWithRedirect>[0]["strategy"], redirectUrl: `/login/sso-callback?next=${encodeURIComponent(next)}`, redirectUrlComplete: next }).catch(() => setFailed(true));
  }, [isLoaded, authLoaded, isSignedIn, signIn, next]);
  return <main className="flex min-h-screen items-center justify-center p-8"><div><h1 role={failed ? "alert" : "status"} className="text-xl font-semibold">{failed ? "Unable to start AgentID sign-in" : "Connecting to AgentID…"}</h1>{failed && <a className="mt-4 block underline" href={`/login?next=${encodeURIComponent(next)}`}>Continue to sign-in</a>}</div></main>;
}
