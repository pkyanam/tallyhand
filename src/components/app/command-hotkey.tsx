"use client";

import * as React from "react";
import { useAppChrome } from "@/components/app/app-chrome-provider";

/** Global ⌘K / Ctrl+K — capture phase so focused inputs do not swallow it. */
export function CommandHotkey() {
  const { commandOpen, setCommandOpen } = useAppChrome();

  const latest = React.useRef({ commandOpen, setCommandOpen });
  React.useEffect(() => {
    latest.current = { commandOpen, setCommandOpen };
  }, [commandOpen, setCommandOpen]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "k" && e.key !== "K") return;
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      const { commandOpen: open, setCommandOpen: set } = latest.current;
      set(!open);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, []);

  return null;
}
