"use client";

import * as React from "react";
import { notifyDataChanged } from "@/lib/data/data-events";
import { cn } from "@/lib/utils";
import type { AppDataMode } from "@/components/app/data-mode-copy";

type ChromeContextValue = {
  dataMode: AppDataMode;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  showNotice: (message: string) => void;
};

const ChromeContext = React.createContext<ChromeContextValue | null>(null);

export function AppChromeProvider({
  children,
  dataMode,
}: {
  children: React.ReactNode;
  dataMode: AppDataMode;
}) {
  const [loadFailed, setLoadFailed] = React.useState(false);
  React.useEffect(() => {
    const failed = () => setLoadFailed(true);
    window.addEventListener("tallyhand:data-load-failed", failed);
    return () => window.removeEventListener("tallyhand:data-load-failed", failed);
  }, []);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const noticeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showNotice = React.useCallback((message: string) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNotice(message);
    noticeTimeoutRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, 3200);
  }, []);

  React.useEffect(
    () => () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    },
    [],
  );

  const value = React.useMemo(
    () => ({
      dataMode,
      commandOpen,
      setCommandOpen,
      showNotice,
    }),
    [commandOpen, dataMode, showNotice],
  );

  return (
    <ChromeContext.Provider value={value}>
      {loadFailed && <div role="alert" className="sticky top-0 z-[100] flex items-center justify-center gap-4 border-b bg-background p-3 text-sm">
        <span>Some data couldn’t load. Check your connection and try again.</span>
        <button className="shrink-0 rounded-md border px-3 py-1 font-medium hover:bg-muted" onClick={() => { setLoadFailed(false); notifyDataChanged(); }}>Retry loading</button>
      </div>}
      {children}
      {notice ? (
        <div
          role="status"
          className={cn(
            "fixed left-1/2 z-[100] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border bg-popover px-4 py-2 text-center text-sm text-popover-foreground shadow-md",
            "bottom-[max(1.5rem,env(safe-area-inset-bottom,0px)+0.75rem)]",
          )}
        >
          {notice}
        </div>
      ) : null}
    </ChromeContext.Provider>
  );
}

export function useAppChrome() {
  const ctx = React.useContext(ChromeContext);
  if (!ctx) throw new Error("useAppChrome must be used within AppChromeProvider");
  return ctx;
}
