"use client";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
export function SsoCallback({ next }: { next?: string }) {
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return <AuthenticateWithRedirectCallback
    signInUrl={`/login${query}`}
    signUpUrl={`/login?mode=sign-up${next ? `&next=${encodeURIComponent(next)}` : ""}`}
    continueSignUpUrl={`/login?mode=sign-up${next ? `&next=${encodeURIComponent(next)}` : ""}`}
    firstFactorUrl={`/login/factor-one${query}`}
    secondFactorUrl={`/login/factor-two${query}`}
    signInForceRedirectUrl={next}
    signUpForceRedirectUrl={next}
  />;
}
