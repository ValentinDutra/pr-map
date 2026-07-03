import { useCallback, useEffect, useState } from 'react';
import type { PrGraph, ReviewState, ReviewThread } from './types';
import { reviewApi } from './review-api';
import { PrContextBar } from './pr-context';
import { DetailPanel } from './detail-panel';
import { ReviewControls } from './review-controls';

export function Sidebar({ graph, width }: { graph: PrGraph; width: number }) {
  const [pending, setPending] = useState<ReviewState | null>(null);
  const [threads, setThreads] = useState<ReviewThread[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    reviewApi
      .getPending()
      .then(setPending)
      .catch(() => setStatus('Could not load pending review (is the server running?)'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshThreads = useCallback(() => {
    reviewApi
      .getThreads()
      .then(setThreads)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshThreads();
  }, [refreshThreads]);

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col gap-4 overflow-auto bg-white p-5 text-sm text-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <PrContextBar />
      <DetailPanel
        graph={graph}
        pending={pending}
        threads={threads}
        onChange={refresh}
        onThreadsChange={refreshThreads}
        setStatus={setStatus}
      />
      <ReviewControls
        pending={pending}
        refresh={refresh}
        status={status}
        setStatus={setStatus}
      />
    </aside>
  );
}
