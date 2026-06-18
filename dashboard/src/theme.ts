import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'pr-map-theme';

// Start from the saved choice, falling back to the OS preference.
function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const theme = initialTheme();
  applyTheme(theme);
  return {
    theme,
    setTheme: (next) => {
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      set({ theme: next });
    },
    toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  };
});
