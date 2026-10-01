"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
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

/** Local mode never loads this optional cloud-only subscription bundle. */
export function ConvexRealtimeProvider({ url, children }: { url: string; children: ReactNode }) {
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
      <WorkspaceSubscription />
      {children}
    </ConvexProviderWithClerk>
  );
}
