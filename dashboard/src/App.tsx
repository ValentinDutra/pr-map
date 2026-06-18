import { useEffect, useState } from 'react';
import { GraphView } from './graph-view';
import { Sidebar } from './sidebar';
import { useTheme } from './theme';
import { useResizablePanel } from './use-resizable-panel';
import { useReviewRefresh } from './store';
import { useViewedState } from './viewed-state';
import { reviewApi } from './review-api';
import graphFixture from './__fixtures__/graph.json';
import type { ChecksState, ChecksSummary, PrGraph, ReviewEvent } from './types';

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

const CHECKS_BADGE_STYLES: Record<ChecksState, { label: string; className: string }> = {
  success: {
    label: 'Checks passing',
    className:
      'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300',
  },
  failure: {
    label: 'Checks failing',
    className:
      'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  },
  pending: {
    label: 'Checks pending',
    className:
      'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
};

// A single check's state drives the dot color in the popover; failing conclusions and the
// in-flight lifecycle map to red/amber, everything settled and clean maps to green.
function checkStateColor(check: ChecksSummary['checks'][number]): string {
  if (check.status === 'queued' || check.status === 'in_progress' || check.conclusion === '') {
    return 'bg-amber-500';
  }
  if (check.conclusion === 'success' || check.conclusion === 'neutral' || check.conclusion === 'skipped') {
    return 'bg-green-500';
  }
  return 'bg-red-500';
}

function ChecksBadge() {
  const [checks, setChecks] = useState<ChecksSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    reviewApi
      .getChecks()
      .then((summary) => {
        if (!cancelled) setChecks(summary);
      })
      // No checks endpoint (static build) or no checks on the PR: hide the badge silently.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!checks) return null;

  const style = CHECKS_BADGE_STYLES[checks.state];

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={style.label}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${style.className}`}
      >
        {style.label}
      </button>
      {open && checks.checks.length > 0 ? (
        <div className="absolute right-0 top-8 z-20 flex max-h-80 w-72 flex-col gap-1 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {checks.checks.map((check, index) => (
            <div key={`${check.name}-${index}`} className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${checkStateColor(check)}`} />
              {check.url ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-purple-700 hover:underline dark:text-purple-300"
                  title={check.name}
                >
                  {check.name}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200" title={check.name}>
                  {check.name}
                </span>
              )}
              <span className="shrink-0 text-slate-500 dark:text-slate-400">
                {check.conclusion || check.status}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [graph, setGraph] = useState<PrGraph | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
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
          <ChecksBadge />
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
