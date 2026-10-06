"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentIdSignInButton } from "./agentid-sign-in-button";
import styles from "./clerk-login.module.css";

export function ClerkLogin({ mode, redirectUrlComplete, agentIdEnabled }: {
  mode?: string;
  redirectUrlComplete: string;
  agentIdEnabled: boolean;
}) {
  const entryPage = usePathname() === "/login";
  const signingUp = mode === "sign-up";
  const appearance = {
    variables: {
      colorPrimary: "hsl(var(--primary))",
      colorText: "hsl(var(--foreground))",
      colorTextSecondary: "hsl(var(--muted-foreground))",
      colorBackground: "hsl(var(--background))",
      colorInputBackground: "hsl(var(--background))",
      colorInputText: "hsl(var(--foreground))",
      colorNeutral: "hsl(var(--foreground))",
      fontFamily: "inherit",
      borderRadius: "0.375rem",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: 0 },
      card: { padding: 0, background: "transparent", boxShadow: "none", border: 0, gap: "24px" },
      ...(entryPage ? { header: { display: "none" } } : {}),
      footer: { background: "transparent" },
      footerAction: { paddingLeft: 0, paddingRight: 0 },
    },
  };

  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
    <section aria-label="Tallyhand sign-in" className={`${styles.card} w-full max-w-[440px] rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8`}>
      <Link href="/" className="mb-8 flex w-fit items-center gap-3 text-xl font-semibold tracking-tight" aria-label="Tallyhand home">
        <Image src="/brand/tallyhand-mark.png" alt="" width={40} height={40} className="mix-blend-multiply dark:invert dark:mix-blend-screen" />
        Tallyhand
      </Link>
      {entryPage && <>
        <h1 className="text-2xl font-semibold tracking-tight">{signingUp ? "Create your Tallyhand account" : "Sign in to Tallyhand"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Track time, manage projects, and turn your work into invoices.</p>
        <p className="mb-6 mt-5 text-xs leading-5 text-muted-foreground">By continuing, you agree to the <Link href="/terms" className="underline underline-offset-4">Terms of Service</Link> and acknowledge the <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link>.</p>
        {agentIdEnabled && <div className="mb-3"><AgentIdSignInButton redirectUrlComplete={redirectUrlComplete} /></div>}
      </>}
      {signingUp ? <SignUp forceRedirectUrl={redirectUrlComplete} appearance={appearance} /> : <SignIn forceRedirectUrl={redirectUrlComplete} appearance={appearance} />}
      <div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        <Link href="/docs" className="underline underline-offset-4">Documentation</Link>
      </div>
    </section>
  </main>;
}
