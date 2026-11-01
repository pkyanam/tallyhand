"use client";

import { useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AdmissionNotice({ reason, onRetry }: {
  reason: "clearance_denied" | "verification_unavailable";
  onRetry?: () => Promise<void>;
}) {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const denied = reason === "clearance_denied";
  const retry = async () => {
    setPending(true);
    try { if (onRetry) await onRetry(); else window.location.reload(); }
    finally { setPending(false); }
  };
  const switchAccount = async () => {
    setPending(true); setSwitchFailed(false);
    try { await signOut({ redirectUrl: "/login" }); }
    catch { setSwitchFailed(true); setPending(false); }
  };
  return <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center px-6 py-12">
    <div role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{denied ? "This account needs Tallyhand access" : "We couldn’t verify Tallyhand access"}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{denied
        ? "This AgentID account does not have agentsub clearance for Tallyhand. Switch to an admitted AgentID account or your regular Tallyhand account."
        : "Access verification is temporarily unavailable. Retry in a moment, or switch accounts."}</p>
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <Button onClick={() => { void switchAccount(); }} disabled={pending}>Sign out and switch accounts</Button>
      <Button variant="outline" onClick={() => { void retry(); }} disabled={pending}>{pending ? "Please wait…" : "Retry access check"}</Button>
    </div>
    {switchFailed && <p role="alert" className="mt-3 text-sm">Sign-out failed. Please try again.</p>}
    <Link href="/" className="mt-6 self-start text-sm underline underline-offset-4">Return to Tallyhand home</Link>
  </main>;
}
