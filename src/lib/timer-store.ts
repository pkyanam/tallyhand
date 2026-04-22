"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PendingEntry {
  startAt: number;
  endAt: number;
  projectId: string | null;
  name: string;
  notes: string;
  tags: string[];
}

interface TimerState {
  running: boolean;
  startedAt: number | null;
  projectId: string | null;
  pending: PendingEntry | null;
  promptOpen: boolean;

  start: (projectId?: string | null) => void;
  stop: () => PendingEntry | null;
  cancelRunning: () => void;
  setProject: (projectId: string | null) => void;

  openPrompt: () => void;
  closePrompt: () => void;
  setPending: (entry: PendingEntry | null) => void;
  updatePending: (patch: Partial<PendingEntry>) => void;
  clearPending: () => void;
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      running: false,
      startedAt: null,
      projectId: null,
      pending: null,
      promptOpen: false,

      start: (projectId) =>
        set({
          running: true,
          startedAt: Date.now(),
          projectId: projectId ?? get().projectId ?? null,
        }),

      stop: () => {
        const { startedAt, projectId, running } = get();
        if (!running || startedAt == null) return null;
        const endAt = Date.now();
        const entry: PendingEntry = {
          startAt: startedAt,
          endAt,
          projectId: projectId ?? null,
          name: "",
          notes: "",
          tags: [],
        };
        set({
          running: false,
          startedAt: null,
          pending: entry,
          promptOpen: true,
        });
        return entry;
      },

      cancelRunning: () =>
        set({ running: false, startedAt: null }),

      setProject: (projectId) => set({ projectId }),

      openPrompt: () => set({ promptOpen: true }),
      closePrompt: () => set({ promptOpen: false }),

      setPending: (entry) =>
        set({ pending: entry, promptOpen: entry != null }),

      updatePending: (patch) => {
        const cur = get().pending;
        if (!cur) return;
        set({ pending: { ...cur, ...patch } });
      },

      clearPending: () => set({ pending: null, promptOpen: false }),
    }),
    {
      name: "tallyhand.timer",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        running: state.running,
        startedAt: state.startedAt,
        projectId: state.projectId,
        pending: state.pending,
      }),
    },
  ),
);
