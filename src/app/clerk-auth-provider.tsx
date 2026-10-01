"use client";

/**
 * Clerk provider wrapper, loaded ONLY when TALLY_AUTH=clerk.
 *
 * This module is imported via next/dynamic from the root layout, so the
 * @clerk/nextjs client bundle is code-split into its own chunk and never
 * downloaded in local (dexie/sqlite) mode. The publishable key is passed
 * as a prop from the server layout (runtime env — no rebuild needed to
 * rotate it, unlike NEXT_PUBLIC_* vars).
 */
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const ConvexRealtimeProvider = dynamic(() => import("@/components/app/convex-realtime-provider").then((m) => m.ConvexRealtimeProvider));

export function ClerkAuthProvider({
  children,
  publishableKey,
  convexUrl,
}: {
  children: ReactNode;
  publishableKey: string;
  convexUrl?: string;
}) {
  return <ClerkProvider publishableKey={publishableKey}>
    {convexUrl ? <ConvexRealtimeProvider url={convexUrl}>{children}</ConvexRealtimeProvider> : children}
  </ClerkProvider>;
}
