import { useEffect, useState } from 'react';
import { GraphView } from './graph-view';
import { Sidebar } from './sidebar';
import { useTheme } from './theme';
import { useResizablePanel } from './use-resizable-panel';
import { useReviewRefresh } from './store';
import { reviewApi } from './review-api';
import graphFixture from './__fixtures__/graph.json';
import type { PrGraph, ReviewEvent } from './types';

const fixtureGraph = graphFixture as unknown as PrGraph;

const VERDICTS: { event: ReviewEvent; label: string }[] = [
  { event: 'APPROVE', label: 'Approve' },
  { event: 'REQUEST_CHANGES', label: 'Request changes' },
  { event: 'COMMENT', label: 'Comment' },
];

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

function FinishReviewTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bump = useReviewRefresh((state) => state.bump);
  const [summary, setSummary] = useState('');
  const [verdict, setVerdict] = useState<ReviewEvent>('COMMENT');
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    reviewApi
      .getPending()
      .then((state) => setPendingCount(state.comments.length))
      .catch(() => setStatus('Could not load pending review (is the server running?)'));
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await reviewApi.setSummary(summary);
      await reviewApi.submit(verdict);
      setStatus(`Submitted review: ${verdict}`);
      setSummary('');
      bump();
      onClose();
    } catch (error) {
      setStatus(`Submit failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="absolute right-4 top-12 z-20 flex w-80 flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="font-semibold text-slate-700 dark:text-slate-200">
        Finish review · {pendingCount} pending comment{pendingCount === 1 ? '' : 's'}
      </div>
      <textarea
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="Review summary (the PR-level comment)…"
        className="h-20 rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      <div className="flex flex-col gap-1">
        {VERDICTS.map((option) => (
          <label key={option.event} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="verdict"
              checked={verdict === option.event}
              onChange={() => setVerdict(option.event)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        className="self-start rounded bg-slate-800 px-3 py-1 text-white dark:bg-slate-700"
      >
        Submit review
      </button>
      {status ? <div className="text-[11px] text-slate-500 dark:text-slate-400">{status}</div> : null}
    </div>
  );
}

export function App() {
  const [graph, setGraph] = useState<PrGraph | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const { width, startResize } = useResizablePanel();

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
      <header className="relative flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">pr-map</span>
          {graph ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              #{graph.meta.number} {graph.meta.title}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTrayOpen((open) => !open)}
            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            Finish review
          </button>
          <ThemeToggle />
        </div>
        <FinishReviewTray open={trayOpen} onClose={() => setTrayOpen(false)} />
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
