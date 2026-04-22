"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ChromeContextValue = {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  showNotice: (message: string) => void;
};

const ChromeContext = React.createContext<ChromeContextValue | null>(null);

export function AppChromeProvider({ children }: { children: React.ReactNode }) {
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
      commandOpen,
      setCommandOpen,
      showNotice,
    }),
    [commandOpen, showNotice],
  );

  return (
    <ChromeContext.Provider value={value}>
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
