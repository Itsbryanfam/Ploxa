"use client";

import { create } from "zustand";

import { DEFAULT_MASCOT_STATE, type MascotState, type MascotMood } from "./states";

interface MascotStore {
  state: MascotState;
  setMood: (mood: MascotMood, opts?: { message?: string; durationMs?: number }) => void;
  celebrate: (message?: string) => void;
}

export const useMascotStore = create<MascotStore>((set, get) => {
  let revertTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    state: DEFAULT_MASCOT_STATE,
    setMood: (mood, opts) => {
      if (revertTimer) {
        clearTimeout(revertTimer);
        revertTimer = null;
      }
      set({ state: { mood, message: opts?.message, durationMs: opts?.durationMs } });
      if (opts?.durationMs) {
        revertTimer = setTimeout(() => {
          set({ state: DEFAULT_MASCOT_STATE });
          revertTimer = null;
        }, opts.durationMs);
      }
    },
    celebrate: (message) => get().setMood("celebrating", { message, durationMs: 1500 }),
  };
});
