import { create } from 'zustand';

// Tracks which files a reviewer has already looked at, so progress on a large PR survives
// reloads. Kept here (not in the shared store) so the feature stays self-contained: it owns
// its own localStorage persistence and nothing else reads or writes it.

const STORAGE_PREFIX = 'pr-map-viewed';

// One localStorage entry per PR so two open PRs never share or overwrite each other's progress.
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
    // Corrupt or unavailable storage should degrade to "nothing viewed", never crash the app.
    return new Set();
  }
}

function writeViewedPaths(key: string, paths: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(paths)));
  } catch {
    // Storage being full or blocked must not break toggling a checkbox.
  }
}

interface ViewedState {
  // The localStorage key for the PR currently loaded; null until a PR is bound.
  currentKey: string | null;
  viewedPaths: Set<string>;
  // Bind the store to a PR identity, hydrating its viewed set from localStorage. Re-binding to
  // a different PR swaps in that PR's set, so switching PRs never leaks progress between them.
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
