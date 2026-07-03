import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const STORAGE_KEY = 'pr-map-sidebar-width';
const MIN_PANEL_WIDTH = 360;
const MIN_GRAPH_WIDTH = 360;

function clampWidth(width: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_GRAPH_WIDTH);
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max);
}

function initialWidth(): number {
  const stored = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '', 10);
  if (!Number.isNaN(stored)) return clampWidth(stored);
  return clampWidth(Math.round(window.innerWidth * 0.45));
}

export function useResizablePanel(): {
  width: number;
  startResize: (event: ReactPointerEvent) => void;
} {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);

  const startResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    dragging.current = true;
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      setWidth(clampWidth(window.innerWidth - event.clientX));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setWidth((current) => {
        window.localStorage.setItem(STORAGE_KEY, String(current));
        return current;
      });
    };
    const onResize = () => setWidth((current) => clampWidth(current));

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return { width, startResize };
}
