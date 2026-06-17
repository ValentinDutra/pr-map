import { create } from 'zustand';

interface SelectionState {
  selectedNodeId: string | null;
  select: (id: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedNodeId: null,
  select: (id) => set({ selectedNodeId: id }),
}));
