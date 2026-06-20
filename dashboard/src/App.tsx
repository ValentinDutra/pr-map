import { useEffect, useState } from 'react';
import { GraphView } from './graph-view';
import { Sidebar } from './sidebar';
import { useTheme } from './theme';
import { useResizablePanel } from './use-resizable-panel';
import { useViewedState } from './viewed-state';
import graphFixture from './__fixtures__/graph.json';
import type { PrGraph } from './types';

const fixtureGraph = graphFixture as unknown as PrGraph;

function ThemeToggle() {
  const theme = useTheme((state) => state.theme);
  const toggle = useTheme((state) => state.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {theme === 'dark' ? 'Light' : 'Dark'} mode
    </button>
  );
}

export function App() {
  const [graph, setGraph] = useState<PrGraph | null>(null);
  const { width, startResize } = useResizablePanel();
  const bindViewedToPr = useViewedState((state) => state.bindToPr);

  // Hydrate the per-PR viewed set from localStorage once the graph's identity is known. Keying
  // by owner/repo/number means switching to a different PR loads that PR's own progress.
  useEffect(() => {
    if (graph) bindViewedToPr(graph.meta.owner, graph.meta.repo, graph.meta.number);
  }, [graph, bindViewedToPr]);

  useEffect(() => {
    // Served by the pr-map server this returns the real PR graph; running the static
    // build alone (no server) falls back to the checked-in fixture.
    const controller = new AbortController();
    fetch('/api/graph', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no graph'))))
      .then((data: PrGraph) => setGraph(data))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setGraph(fixtureGraph);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">pr-map</span>
          {graph ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              #{graph.meta.number} {graph.meta.title}
            </span>
          ) : null}
        </div>
        <ThemeToggle />
      </header>
      {graph ? (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <GraphView graph={graph} />
          </div>
          <div
            onPointerDown={startResize}
            title="Drag to resize the detail panel"
            className="w-1.5 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400 dark:bg-slate-800 dark:hover:bg-slate-600"
          />
          <Sidebar graph={graph} width={width} />
        </div>
      ) : (
        <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading PR graph…</div>
      )}
    </div>
  );
}
