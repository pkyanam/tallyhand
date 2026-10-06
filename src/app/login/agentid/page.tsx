import { effectiveAuth } from "@/lib/mode";
import { safeLocalNext } from "../oauth/continue/validation";
import { AgentIdEntry } from "./agentid-entry";
export default async function AgentIdPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (effectiveAuth() !== "clerk" || !process.env.AGENTID_CLIENT_ID) return <main className="p-8"><h1>AgentID sign-in is unavailable</h1><a href="/login">Continue to sign-in</a></main>;
  return <AgentIdEntry next={safeLocalNext(next ?? "/dashboard")} />;
}
