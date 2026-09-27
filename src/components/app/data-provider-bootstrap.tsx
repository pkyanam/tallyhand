"use client";

import { useEffect } from "react";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { setStorageProvider, getStorageProvider } from "@/lib/db/repos";
import { dexieStorageProvider } from "@/lib/db/dexie-provider";
import { restStorageProvider } from "@/lib/data/rest-storage-provider";
import { notifyDataChanged } from "@/lib/data/data-events";

export function DataProviderBootstrap() {
  const { dataMode } = useAppChrome();
  useEffect(() => {
    const next = dataMode === "cloud" ? restStorageProvider : dexieStorageProvider;
    if (getStorageProvider() !== next) {
      setStorageProvider(next);
      notifyDataChanged();
    }
  }, [dataMode]);
  return null;
}
