"use client";

import * as React from "react";
import { useLiveQuery as useDexieLiveQuery } from "dexie-react-hooks";
import { getStorageProvider } from "@/lib/db/repos";
import { notifyDataLoadFailed, onDataChanged } from "./data-events";

export function useLiveQuery<T>(querier: () => Promise<T> | T, deps?: unknown[]): T | undefined;
export function useLiveQuery<T, D>(querier: () => Promise<T> | T, deps: unknown[], defaultValue: D): T | D;
export function useLiveQuery<T>(querier: () => Promise<T> | T, deps: unknown[] = [], defaultValue?: T): T | undefined {
  const depsKey = JSON.stringify(deps);
  const [value, setValue] = React.useState<T | undefined>(defaultValue);
  const [, setRevision] = React.useState(0);
  const isDexie = getStorageProvider().providerName === "dexie";
  const inertQuery = React.useCallback(() => Promise.resolve(defaultValue as T), [defaultValue]);
  const dexieResult = useDexieLiveQuery(
    isDexie ? querier : inertQuery,
    deps,
    defaultValue,
  );

  React.useEffect(() => {
    let active = true;
    let requestVersion = 0;
    const run = () => {
      setRevision((n) => n + 1);
      if (isDexie) return;
      const version = ++requestVersion;
      void Promise.resolve().then(querier).then((next: T) => {
        if (active && version === requestVersion) setValue(next);
      }).catch((error: unknown) => {
        if (active && version === requestVersion) {
          console.error("Live query failed", error);
          notifyDataLoadFailed();
        }
      });
    };
    run();
    const unsubscribe = onDataChanged(run);
    return () => { active = false; unsubscribe(); };
  // depsKey preserves the original hook's value-based dependency behavior.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDexie, depsKey]);

  return isDexie ? dexieResult : value;
}
