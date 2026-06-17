import { useCallback, useEffect, useState } from 'react';
import type { PrGraph, ReviewState } from './types';
import { reviewApi } from './review-api';
import { useReviewRefresh } from './store';
import { DetailPanel } from './detail-panel';
import { ReviewControls } from './review-controls';

export function Sidebar({ graph }: { graph: PrGraph }) {
  const [pending, setPending] = useState<ReviewState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const version = useReviewRefresh((state) => state.version);

  const refresh = useCallback(() => {
    reviewApi
      .getPending()
      .then(setPending)
      .catch(() => setStatus('Could not load pending review (is the server running?)'));
  }, []);

  // Re-fetch when this panel mounts and whenever another panel (the Finish-review tray) mutates.
  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col gap-4 overflow-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <DetailPanel graph={graph} pending={pending} onChange={refresh} setStatus={setStatus} />
      <ReviewControls
        pending={pending}
        refresh={refresh}
        status={status}
        setStatus={setStatus}
      />
    </aside>
  );
}
