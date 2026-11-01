"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdmissionNotice } from "./admission-notice";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useQuery, useAction } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { makeFunctionReference } from "convex/server";
import { notifyDataChanged } from "@/lib/data/data-events";

const revisionQuery = makeFunctionReference<"query", { userId: string }, number>("workspace:revision");

const refreshAdmission = makeFunctionReference<"action", Record<string, never>, { allowed: boolean; expiresAt: number; reason?: "clearance_denied" }>("admission:refresh");
export function isAdmissionWorkspacePath(path: string): boolean {
  return /^\/(dashboard|timesheet|ledger|clients|projects|invoices|expenses|analytics|tax|reckoning|settings|shortcuts)(\/|$)/.test(path);
}
function AdmissionBoundary({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const { userId, sessionId } = useAuth();
  const isWorkspace = isAdmissionWorkspacePath(usePathname() ?? "");
  const refresh = useAction(refreshAdmission);
  const [state, setState] = useState<{ userId: string; sessionId?: string | null; allowed: boolean; expiresAt: number; reason?: "clearance_denied" } | null>(null);
  useEffect(() => {
    if (!isWorkspace || !isAuthenticated || !userId) { setState(null); return; }
    let active = true;
    const check = async () => {
      try { const result = await refresh({}); if (active) setState({ userId, sessionId, ...result }); }
      catch { if (active) setState({ userId, sessionId, allowed: false, expiresAt: 0 }); }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [isWorkspace, isAuthenticated, userId, sessionId, refresh]);
  if (!isWorkspace || !isAuthenticated) return children;
  if (!state || state.userId !== userId || state.sessionId !== sessionId) return <p role="status">Verifying application access…</p>;
  if (!state.allowed || state.expiresAt <= Date.now()) return <AdmissionNotice reason={state.reason ?? "verification_unavailable"} />;
  return <><RealtimeSubscription generation={state.expiresAt} />{children}</>;
}
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

function RealtimeSubscription({ generation = 0 }: { generation?: number }) {
  const { userId, sessionId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const isWorkspace = isAdmissionWorkspacePath(usePathname() ?? "");
  if (!isWorkspace || !isAuthenticated || !userId) return null;
  return <SubscriptionBoundary key={`${sessionId}:${userId}:${generation}`}><WorkspaceSubscription /></SubscriptionBoundary>;
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
      {admissionEnabled ? <AdmissionBoundary>{children}</AdmissionBoundary> : <><RealtimeSubscription />{children}</>}
    </ConvexProviderWithClerk>
  );
}
