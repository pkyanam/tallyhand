"use client";

/** Hosted entry screen: only an active session or explicit local choice skips it. */
import { useAuth } from "@clerk/nextjs";
import { BrandMark } from "@/components/app/brand-mark";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Cloud, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LANDING_CHOICE_KEY,
  LOCAL_CHOICE_COOKIE,
  type LandingChoice,
} from "@/lib/landing";

export function readLandingChoice(): LandingChoice | null {
  try {
    const raw = window.localStorage.getItem(LANDING_CHOICE_KEY);
    return raw === "cloud" || raw === "local" ? raw : null;
  } catch {
    return null;
  }
}

export function writeLandingChoice(choice: LandingChoice): void {
  try {
    window.localStorage.setItem(LANDING_CHOICE_KEY, choice);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
  if (choice === "local") {
    document.cookie = `${LOCAL_CHOICE_COOKIE}=1; path=/; max-age=315360000; SameSite=Lax`;
  } else {
    document.cookie = `${LOCAL_CHOICE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function clearLandingChoice(): void {
  try {
    window.localStorage.removeItem(LANDING_CHOICE_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${LOCAL_CHOICE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.5-1.5 7.8-5.8 7.8-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}

export function LandingChoiceScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const [resolved, setResolved] = React.useState(false);

  React.useEffect(() => {
    if (!isLoaded) return;
    const choice = readLandingChoice();
    if (isSignedIn) {
      // A remembered cloud choice is not proof of a current session.
      window.location.replace("/dashboard");
      return;
    }
    if (choice === "local") {
      // Returning local user: refresh the cookie (it may have expired or
      // been cleared while localStorage survived) and go to the app.
      writeLandingChoice("local");
      window.location.replace("/dashboard");
      return;
    }
    if (choice === "cloud") clearLandingChoice();
    setResolved(true);
  }, [isLoaded, isSignedIn]);

  const choose = (next: LandingChoice, href: string) => {
    writeLandingChoice(next);
    window.location.assign(href);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <BrandMark /> Tallyhand
        </span>
        <Button asChild variant="ghost" size="sm">
          <a
            href="https://github.com/pkyanam/tallyhand"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <GithubIcon className="mr-1.5 h-4 w-4" />
            GitHub
          </a>
        </Button>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 text-sm"><Link className="underline underline-offset-4" href="/docs">Setup guide, CLI & AI connections</Link></div>
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6">
        <div className="max-w-xl py-16">
          <h1 className="font-display text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Tallyhand
          </h1>
          <p className="mt-6 text-balance text-lg leading-relaxed text-muted-foreground">
            Time tracking and invoicing for independent contractors. Start
            with an account, or keep everything on this device — your call.
          </p>

          {resolved ? (
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => choose("cloud", "/login?next=/dashboard")}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-colors hover:border-foreground"
              >
                <Cloud className="h-6 w-6" />
                <span className="mt-4 block text-base font-semibold">
                  Sign in / Create account
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Cloud sync across devices, hosted share links, API
                  tokens, and CLI &amp; MCP access.
                </span>
                <span className="mt-4 inline-flex items-center text-sm font-medium">
                  Continue
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => choose("local", "/dashboard")}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-colors hover:border-foreground"
              >
                <HardDrive className="h-6 w-6" />
                <span className="mt-4 block text-base font-semibold">
                  Use locally
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  No account, no cloud. Your data stays in this browser,
                  exactly like always.
                </span>
                <span className="mt-4 inline-flex items-center text-sm font-medium">
                  Launch app
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            </div>
          ) : (
            <div className="mt-10">
              <Button asChild size="lg" disabled>
                <Link href="/dashboard">
                  Launch app
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            You can switch between account and local use anytime in
            Settings → Account.
          </p>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-muted-foreground">
          <span>Tallyhand by Belweave · MIT-licensed.</span>
          <span className="flex gap-4"><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span>
        </div>
      </footer>
    </div>
  );
}
