import { create } from 'zustand';

interface SelectionState {
  selectedNodeId: string | null;
  select: (id: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedNodeId: null,
  select: (id) => set({ selectedNodeId: id }),
}));

export type DetailTab = 'diff' | 'insights';

interface PanelTabState {
  activeTab: DetailTab;
  setTab: (tab: DetailTab) => void;
}

export const usePanelTab = create<PanelTabState>((set) => ({
  activeTab: 'diff',
  setTab: (tab) => set({ activeTab: tab }),
}));
