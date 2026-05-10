import { create } from "zustand";

type PaletteView = "search" | "quick-log";

interface PaletteState {
  isOpen: boolean;
  view: PaletteView;
  selectedGame: { rawgId: number; title: string; coverUrl: string | null } | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setView: (view: PaletteView) => void;
  selectGame: (game: PaletteState["selectedGame"]) => void;
  reset: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,
  view: "search",
  selectedGame: null,
  open: () => set({ isOpen: true, view: "search" }),
  close: () => set({ isOpen: false, view: "search", selectedGame: null }),
  toggle: () =>
    set((s) => ({ isOpen: !s.isOpen, view: "search", selectedGame: s.isOpen ? null : s.selectedGame })),
  setView: (view) => set({ view }),
  selectGame: (selectedGame) => set({ selectedGame, view: "quick-log" }),
  reset: () => set({ view: "search", selectedGame: null }),
}));
