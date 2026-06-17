import { useState } from 'react';
import type { ReviewState } from './types';
import { reviewApi } from './review-api';

interface ReviewControlsProps {
  pending: ReviewState | null;
  refresh: () => void;
  status: string | null;
  setStatus: (status: string | null) => void;
}

export function ReviewControls({ pending, refresh, status, setStatus }: ReviewControlsProps) {
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
    <section className="mt-auto flex flex-col gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Pending review ({comments.length})
      </div>

      <ul className="flex flex-col gap-1">
        {comments.map((comment) => (
          <li
            key={comment.id}
            className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2 text-xs dark:border-slate-700"
          >
            <div>
              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
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
              className="rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Reply to an existing thread</summary>
        <div className="mt-1 flex flex-col gap-1">
          <input
            value={replyId}
            onChange={(event) => setReplyId(event.target.value)}
            placeholder="GitHub comment id"
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <textarea
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder="Reply…"
            className="h-12 rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            onClick={sendReply}
            className="self-start rounded bg-slate-700 px-2 py-1 text-white"
          >
            Send reply
          </button>
        </div>
      </details>

      {status ? <div className="text-[11px] text-slate-500 dark:text-slate-400">{status}</div> : null}
    </section>
  );
}
