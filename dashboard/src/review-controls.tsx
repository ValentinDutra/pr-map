import { useState } from 'react';
import type { ReviewEvent, ReviewState } from './types';
import { reviewApi } from './review-api';

const VERDICTS: { event: ReviewEvent; label: string; style: string }[] = [
  { event: 'APPROVE', label: 'Approve', style: 'bg-green-600' },
  { event: 'REQUEST_CHANGES', label: 'Request changes', style: 'bg-red-600' },
  { event: 'COMMENT', label: 'Comment', style: 'bg-slate-600' },
];

interface ReviewControlsProps {
  pending: ReviewState | null;
  refresh: () => void;
  status: string | null;
  setStatus: (status: string | null) => void;
}

export function ReviewControls({ pending, refresh, status, setStatus }: ReviewControlsProps) {
  const [confirmVerdict, setConfirmVerdict] = useState<ReviewEvent | null>(null);
  const [replyId, setReplyId] = useState('');
  const [replyBody, setReplyBody] = useState('');

  const comments = pending?.comments ?? [];

  const remove = async (id: string) => {
    try {
      await reviewApi.deleteComment(id);
      refresh();
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`);
    }
  };

  const submit = async (event: ReviewEvent) => {
    if (confirmVerdict !== event) {
      setConfirmVerdict(event);
      return;
    }
    try {
      await reviewApi.submit(event);
      setConfirmVerdict(null);
      setStatus(`Submitted review: ${event}`);
      refresh();
    } catch (error) {
      setStatus(`Submit failed: ${(error as Error).message}`);
    }
  };

  const sendReply = async () => {
    const commentId = Number.parseInt(replyId, 10);
    if (Number.isNaN(commentId) || !replyBody.trim()) return;
    try {
      await reviewApi.reply(commentId, replyBody);
      setReplyId('');
      setReplyBody('');
      setStatus(`Replied to comment ${commentId}`);
    } catch (error) {
      setStatus(`Reply failed: ${(error as Error).message}`);
    }
  };

  return (
    <section className="mt-auto flex flex-col gap-3 border-t border-slate-200 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Pending review ({comments.length})
      </div>

      <ul className="flex flex-col gap-1">
        {comments.map((comment) => (
          <li
            key={comment.id}
            className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2 text-xs"
          >
            <div>
              <div className="font-mono text-[11px] text-slate-600">
                {comment.path}
                {comment.line !== undefined ? `:${comment.line}` : ' (general)'}
              </div>
              <div className="text-slate-700">{comment.body}</div>
            </div>
            <button
              onClick={() => remove(comment.id)}
              className="rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.event}
            onClick={() => submit(verdict.event)}
            className={`rounded px-2 py-1 text-xs text-white ${verdict.style} ${
              confirmVerdict === verdict.event ? 'ring-2 ring-amber-400' : ''
            }`}
          >
            {confirmVerdict === verdict.event ? `Confirm ${verdict.label}` : verdict.label}
          </button>
        ))}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">Reply to an existing thread</summary>
        <div className="mt-1 flex flex-col gap-1">
          <input
            value={replyId}
            onChange={(event) => setReplyId(event.target.value)}
            placeholder="GitHub comment id"
            className="rounded border border-slate-300 px-2 py-1"
          />
          <textarea
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder="Reply…"
            className="h-12 rounded border border-slate-300 p-2"
          />
          <button
            onClick={sendReply}
            className="self-start rounded bg-slate-700 px-2 py-1 text-white"
          >
            Send reply
          </button>
        </div>
      </details>

      {status ? <div className="text-[11px] text-slate-500">{status}</div> : null}
    </section>
  );
}
