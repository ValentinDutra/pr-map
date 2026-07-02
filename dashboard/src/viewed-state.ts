import { create } from 'zustand';

const STORAGE_PREFIX = 'pr-map-viewed';

function storageKey(owner: string, repo: string, number: number): string {
  return `${STORAGE_PREFIX}:${owner}-${repo}-${number}`;
}

function readViewedPaths(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

function writeViewedPaths(key: string, paths: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(paths)));
  } catch {
  }
}

interface ViewedState {
  currentKey: string | null;
  viewedPaths: Set<string>;
  bindToPr: (owner: string, repo: string, number: number) => void;
  toggle: (path: string) => void;
}

export const useViewedState = create<ViewedState>((set, get) => ({
  currentKey: null,
  viewedPaths: new Set(),
  bindToPr: (owner, repo, number) => {
    const key = storageKey(owner, repo, number);
    if (get().currentKey === key) return;
    set({ currentKey: key, viewedPaths: readViewedPaths(key) });
  },
  toggle: (path) => {
    const { currentKey, viewedPaths } = get();
    const nextPaths = new Set(viewedPaths);
    if (nextPaths.has(path)) {
      nextPaths.delete(path);
    } else {
      nextPaths.add(path);
    }
    if (currentKey) writeViewedPaths(currentKey, nextPaths);
    set({ viewedPaths: nextPaths });
  },
}));
