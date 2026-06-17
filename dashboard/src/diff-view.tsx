import { useState } from 'react';
import { reviewApi } from './review-api';
import type { PendingComment } from './types';

interface DiffLineMeta {
  newLine: number | null;
}

// Walks the unified-diff hunks to assign each row its new-file line number.
// Added/context rows get a line you can comment on; removed rows and headers do not.
function computeLineMeta(patch: string): DiffLineMeta[] {
  const meta: DiffLineMeta[] = [];
  let newLine = 0;
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      meta.push({ newLine: null });
    } else if (text.startsWith('-') && !text.startsWith('---')) {
      meta.push({ newLine: null });
    } else if (text.startsWith('+') && !text.startsWith('+++')) {
      meta.push({ newLine });
      newLine += 1;
    } else {
      meta.push({ newLine });
      newLine += 1;
    }
  }
  return meta;
}

function lineBackground(text: string): string {
  if (text.startsWith('+') && !text.startsWith('+++')) return 'bg-green-50 dark:bg-green-950/40';
  if (text.startsWith('-') && !text.startsWith('---')) return 'bg-red-50 dark:bg-red-950/40';
  if (text.startsWith('@@')) return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
  return '';
}

interface DiffViewProps {
  patch: string;
  path: string;
  comments: PendingComment[];
  onChange: () => void;
  setStatus: (status: string | null) => void;
}

function CommentThread({ comment }: { comment: PendingComment }) {
  const range =
    comment.startLine !== undefined ? `lines ${comment.startLine}–${comment.line}` : `line ${comment.line}`;
  return (
    <div className="ml-8 border-l-2 border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-slate-700 dark:bg-amber-950/30 dark:text-slate-200">
      <span className="font-medium text-slate-500 dark:text-slate-400">{range}: </span>
      {comment.body}
    </div>
  );
}

export function DiffView({ patch, path, comments, onChange, setStatus }: DiffViewProps) {
  const lines = patch.split('\n');
  const lineMeta = computeLineMeta(patch);
  const [target, setTarget] = useState<{ startLine?: number; line: number } | null>(null);
  const [body, setBody] = useState('');
  const [fileOpen, setFileOpen] = useState(false);
  const [fileBody, setFileBody] = useState('');

  const lineComments = comments.filter((comment) => comment.scope === 'line');
  const fileComments = comments.filter((comment) => comment.scope === 'file');

  const pickLine = (newLine: number, withShift: boolean) => {
    if (withShift && target) {
      setTarget({
        startLine: Math.min(target.line, newLine),
        line: Math.max(target.line, newLine),
      });
    } else {
      setTarget({ line: newLine });
    }
    setBody('');
  };

  const inRange = (newLine: number | null): boolean => {
    if (newLine === null || !target) return false;
    const start = target.startLine ?? target.line;
    return newLine >= start && newLine <= target.line;
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
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Hover a line for <span className="font-mono">+</span> · shift-click to range
        </span>
        <button
          type="button"
          onClick={() => setFileOpen((open) => !open)}
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
            className="h-14 rounded border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={submitFileComment}
            disabled={!fileBody.trim()}
            className="self-start rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-slate-700"
          >
            Add file comment
          </button>
        </div>
      ) : null}

      {fileComments.map((comment) => (
        <div
          key={comment.id}
          className="border-l-2 border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">file: </span>
          {comment.body}
        </div>
      ))}

      <div className="overflow-auto rounded border border-slate-200 font-mono text-[11px] leading-4 dark:border-slate-700">
        {lines.map((text, lineIndex) => {
          const newLine = lineMeta[lineIndex]?.newLine ?? null;
          const commentable = newLine !== null;
          return (
            <div key={lineIndex} className="group">
              <div className={`flex ${lineBackground(text)} ${inRange(newLine) ? 'ring-1 ring-inset ring-amber-300' : ''}`}>
                <span className="w-5 shrink-0 select-none text-center text-slate-400">
                  {commentable ? (
                    <button
                      type="button"
                      title="Comment on this line (shift-click to range)"
                      onClick={(event) => pickLine(newLine, event.shiftKey)}
                      className="opacity-0 group-hover:opacity-100 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      +
                    </button>
                  ) : null}
                </span>
                <span className="w-8 shrink-0 select-none pr-2 text-right text-slate-400 dark:text-slate-500">
                  {newLine ?? ''}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all">{text || ' '}</span>
              </div>

              {lineComments
                .filter((comment) => comment.line === newLine)
                .map((comment) => (
                  <CommentThread key={comment.id} comment={comment} />
                ))}

              {target && target.line === newLine ? (
                <div className="ml-8 flex flex-col gap-1 py-1">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={
                      target.startLine !== undefined
                        ? `Comment on ${path}:${target.startLine}-${target.line}`
                        : `Comment on ${path}:${target.line}`
                    }
                    className="h-14 rounded border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitLineComment}
                      disabled={!body.trim()}
                      className="rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-slate-700"
                    >
                      Add comment
                    </button>
                    <button
                      type="button"
                      onClick={() => setTarget(null)}
                      className="rounded px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
