"use client";

/**
 * Settings → Account card, rendered ONLY when the effective auth mode is
 * `clerk` (loaded via next/dynamic from settings-content, so the
 * @clerk/nextjs client bundle never loads in other modes).
 *
 * Shows the current landing choice (account vs. local use), lets the user
 * switch, and links to Settings → Connect (API tokens + integration docs).
 */
import * as React from "react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LANDING_CHOICE_KEY,
  LOCAL_CHOICE_COOKIE,
  type LandingChoice,
} from "@/lib/landing";

function readChoice(): LandingChoice | null {
  try {
    const raw = window.localStorage.getItem(LANDING_CHOICE_KEY);
    return raw === "cloud" || raw === "local" ? raw : null;
  } catch {
    return null;
  }
}

export function ClerkAccountCard() {
  const { signOut } = useClerk();
  const { user, isSignedIn } = useUser();
  const [choice, setChoice] = React.useState<LandingChoice | null>(null);

  React.useEffect(() => {
    setChoice(readChoice());
  }, []);

  const switchToLocal = async () => {
    try {
      window.localStorage.setItem(LANDING_CHOICE_KEY, "local");
    } catch {
      /* ignore */
    }
    document.cookie = `${LOCAL_CHOICE_COOKIE}=1; path=/; max-age=315360000; SameSite=Lax`;
    // Sign out so no Clerk session lingers: local use means zero cloud.
    await signOut({ redirectUrl: "/" });
  };

  const signOutOnly = async () => {
    // Sign out but stay in cloud mode (landing will offer sign-in again).
    try {
      window.localStorage.removeItem(LANDING_CHOICE_KEY);
    } catch {
      /* ignore */
    }
    document.cookie = `${LOCAL_CHOICE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    await signOut({ redirectUrl: "/" });
  };

  const switchToAccount = () => {
    try {
      window.localStorage.removeItem(LANDING_CHOICE_KEY);
    } catch {
      /* ignore */
    }
    document.cookie = `${LOCAL_CHOICE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    window.location.assign("/login");
  };

  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          {isSignedIn
            ? `Signed in${email ? ` as ${email}` : ""}.`
            : "You chose to use Tallyhand locally, without an account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/settings/connect">API tokens &amp; integrations</Link>
        </Button>
        {choice === "local" || !isSignedIn ? (
          <Button type="button" variant="outline" onClick={switchToAccount}>
            Sign in with an account
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => void signOutOnly()}>
              Sign out
            </Button>
            <Button type="button" variant="ghost" onClick={() => void switchToLocal()}>
              Use locally instead
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
