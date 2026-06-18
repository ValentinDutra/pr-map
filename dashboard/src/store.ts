import { create } from 'zustand';

interface SelectionState {
  selectedNodeId: string | null;
  select: (id: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedNodeId: null,
  select: (id) => set({ selectedNodeId: id }),
}));

export type DetailTab = 'diff' | 'insights' | 'conversation';

interface PanelTabState {
  activeTab: DetailTab;
  setTab: (tab: DetailTab) => void;
}

export const usePanelTab = create<PanelTabState>((set) => ({
  activeTab: 'diff',
  setTab: (tab) => set({ activeTab: tab }),
}));

interface ReviewRefreshState {
  version: number;
  bump: () => void;
}

// Bumped after a mutation (submit/conversation) so independent panels re-fetch pending state.
export const useReviewRefresh = create<ReviewRefreshState>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
}));
