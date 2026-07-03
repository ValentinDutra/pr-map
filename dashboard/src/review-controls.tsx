import { useState } from 'react';
import type { ReviewEvent, ReviewState } from './types';
import { reviewApi } from './review-api';

const VERDICTS: { event: ReviewEvent; label: string }[] = [
  { event: 'APPROVE', label: 'Approve' },
  { event: 'REQUEST_CHANGES', label: 'Request changes' },
  { event: 'COMMENT', label: 'Comment' },
];

interface ReviewControlsProps {
  pending: ReviewState | null;
  refresh: () => void;
  status: string | null;
  setStatus: (status: string | null) => void;
}

export function ReviewControls({ pending, refresh, status, setStatus }: ReviewControlsProps) {
  const [summary, setSummary] = useState('');
  const [verdict, setVerdict] = useState<ReviewEvent>('COMMENT');

  const comments = pending?.comments ?? [];

  const remove = async (id: string) => {
    try {
      await reviewApi.deleteComment(id);
      refresh();
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`);
    }
  };

  const submitReview = async () => {
    try {
      await reviewApi.setSummary(summary);
      await reviewApi.submit(verdict);
      setSummary('');
      setStatus(`Submitted review: ${verdict}`);
      refresh();
    } catch (error) {
      setStatus(`Submit failed: ${(error as Error).message}`);
    }
  };

  return (
    <section className="mt-auto flex flex-col gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Pending review ({comments.length})
      </div>

      <ul className="flex flex-col gap-1.5">
        {comments.map((comment) => (
          <li
            key={comment.id}
            className="flex items-start justify-between gap-2 rounded border border-slate-200 p-3 text-sm dark:border-slate-700"
          >
            <div>
              <div className="font-mono text-xs text-slate-600 dark:text-slate-400">
                {comment.path}
                {comment.scope === 'file'
                  ? ' (file)'
                  : comment.line !== undefined
                    ? `:${comment.line}`
                    : ''}
              </div>
              <div className="text-slate-700 dark:text-slate-200">{comment.body}</div>
            </div>
            <button
              onClick={() => remove(comment.id)}
              className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Submit review
        </div>
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Review summary (the PR-level comment)…"
          className="h-20 rounded border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          onClick={submitReview}
          className="self-start rounded bg-slate-800 px-3 py-1.5 text-sm text-white dark:bg-slate-700"
        >
          Submit review
        </button>
      </div>

      {status ? <div className="text-xs text-slate-500 dark:text-slate-400">{status}</div> : null}
    </section>
  );
}
