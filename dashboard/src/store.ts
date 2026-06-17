import { create } from 'zustand';

interface SelectionState {
  selectedNodeId: string | null;
  selectedLine: number | null;
  select: (id: string | null) => void;
  setLine: (line: number | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedNodeId: null,
  selectedLine: null,
  // Selecting a different node clears any line picked in the previous file's diff.
  select: (id) => set({ selectedNodeId: id, selectedLine: null }),
  setLine: (line) => set({ selectedLine: line }),
}));
