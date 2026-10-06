import { effectiveAuth } from "@/lib/mode";
import { safeLocalNext } from "../oauth/continue/validation";
import { SsoCallback } from "./sso-callback";
export default async function SsoCallbackPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (effectiveAuth() !== "clerk") return <main><a href="/login">Continue to sign-in</a></main>;
  const { next } = await searchParams;
  return <SsoCallback next={next ? safeLocalNext(next) : undefined} />;
}
