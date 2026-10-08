"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useQuery, useAction } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { makeFunctionReference } from "convex/server";
import { notifyDataChanged } from "@/lib/data/data-events";

const revisionQuery = makeFunctionReference<"query", { userId: string }, number>("workspace:revision");

function WorkspaceSubscription() {
  const { userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const revision = useQuery(revisionQuery, isAuthenticated && userId ? { userId } : "skip");
  useEffect(() => {
    if (revision !== undefined) notifyDataChanged();
  }, [revision, userId]);
  return null;
}

/** Realtime invalidation is optional; authenticated REST reads still work if it fails. */
class SubscriptionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    console.warn("Tallyhand realtime updates unavailable; workspace reads remain available.");
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const refreshAdmission = makeFunctionReference<"action", Record<string, never>, { allowed: boolean; expiresAt: number }>("admission:refresh");

function RealtimeSubscription({ admissionEnabled }: { admissionEnabled: boolean }) {
  const { userId, sessionId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const pathname = usePathname() ?? "";
  const isWorkspace = /^\/(dashboard|timesheet|ledger|clients|projects|invoices|expenses|analytics|tax|reckoning|settings|shortcuts)(\/|$)/.test(pathname);
  const refresh = useAction(refreshAdmission);
  const [grant, setGrant] = useState<{ sessionId: string; expiresAt: number; generation: number } | null>(null);
  useEffect(() => {
    if (!admissionEnabled || !isWorkspace || !isAuthenticated || !sessionId) return;
    let active = true;
    const check = async () => {
      try {
        const result = await refresh({});
        if (active) setGrant(previous => result.allowed ? {
          sessionId, expiresAt: result.expiresAt, generation: (previous?.generation ?? 0) + 1,
        } : null);
      } catch {
        if (active) setGrant(null);
      }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [admissionEnabled, isWorkspace, isAuthenticated, sessionId, refresh]);
  if (!isWorkspace || !isAuthenticated || !userId) return null;
  if (admissionEnabled && (!grant || grant.sessionId !== sessionId || grant.expiresAt <= Date.now())) return null;
  return <SubscriptionBoundary key={`${sessionId}:${userId}:${grant?.generation ?? 0}`}>
    <WorkspaceSubscription />
  </SubscriptionBoundary>;
}

/** Local mode never loads this optional cloud-only subscription bundle. */
export function ConvexRealtimeProvider({ url, children, admissionEnabled = false }: { url: string; children: ReactNode; admissionEnabled?: boolean }) {
  const resource = useMemo(() => ({
    client: new ConvexReactClient(url),
    closeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  }), [url]);
  useEffect(() => {
    // React StrictMode replays effects. Defer disposal so that replay can
    // retain the same live client, while real unmounts and URL changes close it.
    clearTimeout(resource.closeTimer);
    return () => {
      resource.closeTimer = setTimeout(() => { void resource.client.close(); }, 0);
    };
  }, [resource]);
  const { client } = resource;
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      <RealtimeSubscription admissionEnabled={admissionEnabled} />
      {children}
    </ConvexProviderWithClerk>
  );
}
