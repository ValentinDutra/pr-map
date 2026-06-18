import { useCallback, useEffect, useState } from 'react';
import type { PrGraph, ReviewState } from './types';
import { reviewApi } from './review-api';
import { useReviewRefresh } from './store';
import { DetailPanel } from './detail-panel';
import { ReviewControls } from './review-controls';

export function Sidebar({ graph, width }: { graph: PrGraph; width: number }) {
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
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col gap-4 overflow-auto bg-white p-5 text-sm text-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
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
