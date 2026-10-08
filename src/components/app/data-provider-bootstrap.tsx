"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { setStorageProvider, getStorageProvider } from "@/lib/db/repos";
import { dexieStorageProvider } from "@/lib/db/dexie-provider";
import { restStorageProvider } from "@/lib/data/rest-storage-provider";
import { notifyDataChanged } from "@/lib/data/data-events";

export function DataProviderBootstrap({ children }: { children: ReactNode }) {
  const { dataMode } = useAppChrome();
  const [readyMode, setReadyMode] = useState<string | null>(null);
  useEffect(() => {
    const next = dataMode === "cloud" ? restStorageProvider : dexieStorageProvider;
    if (getStorageProvider() !== next) {
      setStorageProvider(next);
      notifyDataChanged();
    }
    setReadyMode(dataMode);
  }, [dataMode]);
  // Mount readers only after the correct workspace is selected. Child effects
  // otherwise query local Dexie before a signed-in cloud workspace is ready.
  return readyMode === dataMode ? children : null;
}
