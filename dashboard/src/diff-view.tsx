import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { reviewApi } from './review-api';
import { formatCommentTimestamp } from './format';
import type { ExistingReviewComment, PendingComment } from './types';

interface DiffLineMeta {
  oldLine: number | null;
  newLine: number | null;
}

// Walks the unified-diff hunks to assign each row its old- and new-file line numbers,
// the way GitHub renders a split gutter. Added rows have only a new number, removed rows
// only an old number, context rows both; hunk headers and file headers have neither.
function computeLineMeta(patch: string): DiffLineMeta[] {
  const meta: DiffLineMeta[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split('\n')) {
    if (text.startsWith('@@')) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldLine = Number.parseInt(hunk[1], 10);
        newLine = Number.parseInt(hunk[2], 10);
      }
      meta.push({ oldLine: null, newLine: null });
    } else if (
      text.startsWith('+++') ||
      text.startsWith('---') ||
      text.startsWith('diff ') ||
      text.startsWith('index ') ||
      text.startsWith('new file') ||
      text.startsWith('deleted file') ||
      text.startsWith('rename ') ||
      text.startsWith('\\')
    ) {
      // File-level headers and the "\ No newline" marker are not part of the numbered body.
      meta.push({ oldLine: null, newLine: null });
    } else if (text.startsWith('-')) {
      meta.push({ oldLine, newLine: null });
      oldLine += 1;
    } else if (text.startsWith('+')) {
      meta.push({ oldLine: null, newLine });
      newLine += 1;
    } else {
      meta.push({ oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return meta;
}

function lineBackground(text: string): string {
  if (text.startsWith('+') && !text.startsWith('+++')) return 'bg-green-100/70 dark:bg-green-950/40';
  if (text.startsWith('-') && !text.startsWith('---')) return 'bg-red-100/70 dark:bg-red-950/40';
  if (text.startsWith('@@')) return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
  return '';
}

interface DiffViewProps {
  patch: string;
  path: string;
  comments: PendingComment[];
  existingComments: ExistingReviewComment[];
  onChange: () => void;
  setStatus: (status: string | null) => void;
}

// The reviewer's own not-yet-submitted comment: amber, the same accent the pending list uses.
function CommentThread({ comment }: { comment: PendingComment }) {
  const range =
    comment.startLine !== undefined ? `lines ${comment.startLine}–${comment.line}` : `line ${comment.line}`;
  return (
    <div className="border-l-4 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-slate-700 dark:bg-amber-950/30 dark:text-slate-200">
      <span className="font-medium text-slate-500 dark:text-slate-400">{range}: </span>
      {comment.body}
    </div>
  );
}

// A comment already posted to the PR by any reviewer: slate/gray, read-only, with author and
// date so it never reads like one of your own pending amber comments.
function ExistingThread({ comment }: { comment: ExistingReviewComment }) {
  return (
    <div className="border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
      <div className="mb-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-600 dark:text-slate-300">{comment.author}</span>
        <span>·</span>
        <span>{formatCommentTimestamp(comment.createdAt)}</span>
        {comment.inReplyToId !== null ? <span className="italic">reply</span> : null}
      </div>
      <div className="whitespace-pre-wrap break-words font-sans">{comment.body}</div>
    </div>
  );
}

export function DiffView({
  patch,
  path,
  comments,
  existingComments,
  onChange,
  setStatus,
}: DiffViewProps) {
  const lines = patch.split('\n');
  const lineMeta = computeLineMeta(patch);
  const [target, setTarget] = useState<{ startLine?: number; line: number } | null>(null);
  const [body, setBody] = useState('');
  const [fileOpen, setFileOpen] = useState(false);
  const [fileBody, setFileBody] = useState('');
  // The in-progress click-drag over the new-file line numbers (GitHub-style range select).
  const [drag, setDrag] = useState<{ anchor: number; hover: number } | null>(null);
  const dragRef = useRef<{ anchor: number; hover: number } | null>(null);

  const lineComments = comments.filter((comment) => comment.scope === 'line');
  const fileComments = comments.filter((comment) => comment.scope === 'file');
  // Anchor existing comments to the new-file (RIGHT) line, the same gutter the inline UI uses.
  const existingLineComments = existingComments.filter(
    (comment) => comment.side === 'RIGHT' && comment.line !== null,
  );

  // Press the "+" on a line and drag up or down to grow the selection; release to open the box.
  // Holding shift extends the existing selection instead of starting a new one.
  const beginDrag = (newLine: number, event: ReactPointerEvent) => {
    event.preventDefault();
    if (event.shiftKey && target) {
      setTarget({
        startLine: Math.min(target.startLine ?? target.line, newLine),
        line: Math.max(target.line, newLine),
      });
      setBody('');
      return;
    }
    const next = { anchor: newLine, hover: newLine };
    dragRef.current = next;
    setDrag(next);
    setTarget(null);
  };

  // Called as the pointer moves over each line while a drag is active.
  const extendDrag = (newLine: number) => {
    if (!dragRef.current) return;
    const next = { anchor: dragRef.current.anchor, hover: newLine };
    dragRef.current = next;
    setDrag(next);
  };

  // One continuous tracker on the scroll container: while a drag is active, read the
  // new-file line under the cursor and grow the selection — but only re-render when the
  // line actually changes, so dragging stays smooth even on a long diff.
  const trackDrag = (event: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-newline]');
    const raw = row?.dataset.newline;
    if (!raw) return;
    const newLine = Number.parseInt(raw, 10);
    if (Number.isNaN(newLine) || dragRef.current.hover === newLine) return;
    extendDrag(newLine);
  };

  useEffect(() => {
    const finishDrag = () => {
      const current = dragRef.current;
      if (!current) return;
      dragRef.current = null;
      setDrag(null);
      const start = Math.min(current.anchor, current.hover);
      const end = Math.max(current.anchor, current.hover);
      setTarget(start === end ? { line: end } : { startLine: start, line: end });
      setBody('');
    };
    window.addEventListener('pointerup', finishDrag);
    return () => window.removeEventListener('pointerup', finishDrag);
  }, []);

  // Highlight follows the live drag while dragging, otherwise the committed selection.
  const selection = drag
    ? { start: Math.min(drag.anchor, drag.hover), end: Math.max(drag.anchor, drag.hover) }
    : target
      ? { start: target.startLine ?? target.line, end: target.line }
      : null;

  // Border classes that make the whole multi-line selection read as ONE rectangle:
  // left/right on every selected row, a top edge on the first row and a bottom edge on the
  // last one — no internal horizontal lines dividing the selected lines.
  const rangeBorders = (newLine: number | null): string => {
    if (newLine === null || selection === null) return '';
    if (newLine < selection.start || newLine > selection.end) return '';
    const sides = ['border-x-2', 'border-amber-400'];
    if (newLine === selection.start) sides.push('border-t-2');
    if (newLine === selection.end) sides.push('border-b-2');
    return sides.join(' ');
  };

  const submitLineComment = async () => {
    if (!target || !body.trim()) return;
    try {
      await reviewApi.addComment({
        scope: 'line',
        path,
        line: target.line,
        startLine: target.startLine,
        side: 'RIGHT',
        startSide: target.startLine !== undefined ? 'RIGHT' : undefined,
        body,
      });
      setTarget(null);
      setBody('');
      setStatus(null);
      onChange();
    } catch (error) {
      setStatus(`Add comment failed: ${(error as Error).message}`);
    }
  };

  const submitFileComment = async () => {
    if (!fileBody.trim()) return;
    try {
      await reviewApi.addComment({ scope: 'file', path, body: fileBody });
      setFileBody('');
      setFileOpen(false);
      setStatus(null);
      onChange();
    } catch (error) {
      setStatus(`Add file comment failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Click <span className="font-mono">+</span> on a line, or drag down to select a range
        </span>
        <button
          type="button"
          onClick={() => setFileOpen((open) => !open)}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Comment on file
        </button>
      </div>

      {fileOpen ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={fileBody}
            onChange={(event) => setFileBody(event.target.value)}
            placeholder={`Whole-file comment on ${path}`}
            className="h-20 rounded border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={submitFileComment}
            disabled={!fileBody.trim()}
            className="self-start rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-700"
          >
            Add file comment
          </button>
        </div>
      ) : null}

      {fileComments.map((comment) => (
        <div
          key={comment.id}
          className="border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">file: </span>
          {comment.body}
        </div>
      ))}

      <div
        onPointerMove={trackDrag}
        className={`overflow-auto rounded-md border border-slate-200 font-mono text-[13px] leading-6 dark:border-slate-700 ${
          drag ? 'select-none' : ''
        }`}
      >
        {lines.map((text, lineIndex) => {
          const { oldLine, newLine } = lineMeta[lineIndex] ?? { oldLine: null, newLine: null };
          const commentable = newLine !== null;
          return (
            <div key={lineIndex} className="group">
              <div
                data-newline={newLine ?? ''}
                className={`flex ${lineBackground(text)} ${rangeBorders(newLine)}`}
              >
                <span className="w-6 shrink-0 select-none border-r border-slate-100 text-center text-slate-400 dark:border-slate-800">
                  {commentable ? (
                    <button
                      type="button"
                      title="Click to comment, or drag to select multiple lines"
                      onPointerDown={(event) => beginDrag(newLine, event)}
                      className="cursor-pointer font-semibold text-slate-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      +
                    </button>
                  ) : null}
                </span>
                <span className="w-12 shrink-0 select-none border-r border-slate-100 px-2 text-right text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  {oldLine ?? ''}
                </span>
                <span
                  onPointerDown={commentable ? (event) => beginDrag(newLine, event) : undefined}
                  title={commentable ? 'Click to comment, or drag to select multiple lines' : undefined}
                  className={`w-12 shrink-0 select-none border-r border-slate-100 px-2 text-right text-slate-400 dark:border-slate-800 dark:text-slate-500 ${
                    commentable ? 'cursor-pointer hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-300' : ''
                  }`}
                >
                  {newLine ?? ''}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-words px-3">{text || ' '}</span>
              </div>

              {existingLineComments
                .filter((comment) => comment.line === newLine)
                .map((comment) => (
                  <ExistingThread key={comment.id} comment={comment} />
                ))}

              {lineComments
                .filter((comment) => comment.line === newLine)
                .map((comment) => (
                  <CommentThread key={comment.id} comment={comment} />
                ))}

              {target && target.line === newLine ? (
                <div className="flex flex-col gap-2 bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={
                      target.startLine !== undefined
                        ? `Comment on ${path}:${target.startLine}-${target.line}`
                        : `Comment on ${path}:${target.line}`
                    }
                    className="h-20 rounded border border-slate-300 p-2 font-sans text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitLineComment}
                      disabled={!body.trim()}
                      className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-700"
                    >
                      Add comment
                    </button>
                    <button
                      type="button"
                      onClick={() => setTarget(null)}
                      className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
