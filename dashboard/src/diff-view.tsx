import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AiChatPopup } from './ask-popup';
import { buildCodeContext } from './code-context';
import { reviewApi } from './review-api';
import { formatCommentTimestamp } from './format';
import { buildSuggestionBlock, currentLineContents, hasSuggestionBlock } from './suggestion';
import { useAiChatOpen } from './store';
import { languageForPath, tokenizeCode, type SyntaxToken } from './syntax';
import type { PendingComment, ReviewThread } from './types';

const VIRTUALIZE_THRESHOLD = 200;
const ESTIMATED_ROW_HEIGHT = 24;

export interface DiffLineMeta {
  oldLine: number | null;
  newLine: number | null;
}

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

function renderToken(token: SyntaxToken, key: number): ReactNode {
  if (typeof token === 'string') return token;
  const content = Array.isArray(token.content)
    ? token.content.map((child, index) => renderToken(child as SyntaxToken, index))
    : renderToken(token.content as SyntaxToken, 0);
  const aliasName = Array.isArray(token.alias) ? token.alias.join(' ') : token.alias;
  return (
    <span key={key} className={`token ${token.type}${aliasName ? ` ${aliasName}` : ''}`}>
      {content}
    </span>
  );
}

function DiffCode({ text, language }: { text: string; language: string | null }): ReactNode {
  if (!language || text === '') return text || ' ';
  const marker = text[0];
  const hasMarker = marker === '+' || marker === '-' || marker === ' ';
  const code = hasMarker ? text.slice(1) : text;
  return (
    <>
      {hasMarker ? marker : ''}
      {tokenizeCode(code, language).map((token, index) => renderToken(token, index))}
    </>
  );
}

interface DiffViewProps {
  patch: string;
  path: string;
  comments: PendingComment[];
  threads: ReviewThread[];
  onChange: () => void;
  onThreadsChange: () => void;
  setStatus: (status: string | null) => void;
}

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

function ExistingReviewThread({
  thread,
  onThreadsChange,
  setStatus,
}: {
  thread: ReviewThread;
  onThreadsChange: () => void;
  setStatus: (status: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(!thread.isResolved);
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const rootCommentId = thread.comments[0]?.id ?? null;

  const sendReply = async () => {
    if (!replyBody.trim() || rootCommentId === null) return;
    setReplyBusy(true);
    try {
      await reviewApi.reply(rootCommentId, replyBody);
      setReplyBody('');
      setReplyOpen(false);
      setStatus('Replied to thread');
      onThreadsChange();
    } catch (error) {
      setStatus(`Reply failed: ${(error as Error).message}`);
    } finally {
      setReplyBusy(false);
    }
  };

  const toggleResolved = async () => {
    setBusy(true);
    try {
      if (thread.isResolved) {
        await reviewApi.unresolveThread(thread.id);
      } else {
        await reviewApi.resolveThread(thread.id);
      }
      setStatus(null);
      onThreadsChange();
    } catch (error) {
      setStatus(`${thread.isResolved ? 'Unresolve' : 'Resolve'} thread failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const accent = thread.isResolved
    ? 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/30'
    : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60';

  return (
    <div className={`border-l-4 px-3 py-2 text-sm ${accent}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {thread.isResolved ? (
            <span className="rounded border border-green-300 bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              Resolved
            </span>
          ) : (
            <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
              Unresolved
            </span>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
          </span>
          {thread.isResolved ? (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="text-xs text-slate-500 hover:underline dark:text-slate-400"
            >
              {expanded ? 'Hide' : 'Show'}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleResolved}
          disabled={busy}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {thread.isResolved ? 'Unresolve' : 'Resolve'}
        </button>
      </div>
      {expanded ? (
        <>
          {thread.comments.map((comment, index) => (
            <div
              key={comment.id ?? index}
              className={`text-slate-700 dark:text-slate-200 ${index > 0 ? 'mt-2 border-t border-slate-200 pt-2 dark:border-slate-700' : ''}`}
            >
              <div className="mb-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-600 dark:text-slate-300">{comment.author}</span>
                <span>·</span>
                <span>{formatCommentTimestamp(comment.createdAt)}</span>
                {index > 0 ? <span className="italic">reply</span> : null}
              </div>
              <div className="whitespace-pre-wrap break-words font-sans">{comment.body}</div>
            </div>
          ))}
          {rootCommentId !== null ? (
            <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
              {replyOpen ? (
                <div className="flex flex-col gap-1">
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Reply…"
                    className="h-16 rounded border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={sendReply}
                      disabled={!replyBody.trim() || replyBusy}
                      className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-40"
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyOpen(false);
                        setReplyBody('');
                      }}
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setReplyOpen(true)}
                  className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                >
                  Reply
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function DiffView({
  patch,
  path,
  comments,
  threads,
  onChange,
  onThreadsChange,
  setStatus,
}: DiffViewProps) {
  const lines = patch.split('\n');
  const lineMeta = computeLineMeta(patch);
  const language = languageForPath(path);
  const [target, setTarget] = useState<{ startLine?: number; line: number } | null>(null);
  const [body, setBody] = useState('');
  const [fileOpen, setFileOpen] = useState(false);
  const [fileBody, setFileBody] = useState('');
  const [drag, setDrag] = useState<{ anchor: number; hover: number } | null>(null);
  const dragRef = useRef<{ anchor: number; hover: number } | null>(null);
  const [aiChat, setAiChat] = useState<{
    anchorRect: { top: number; bottom: number; left: number };
    code: string;
    label: string;
    anchorLine: number;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const setAiChatOpen = useAiChatOpen((s) => s.setOpen);

  const lineComments = comments.filter((comment) => comment.scope === 'line');
  const fileComments = comments.filter((comment) => comment.scope === 'file');
  const lineThreads = threads.filter((thread) => thread.line !== null);

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

  const extendDrag = (newLine: number) => {
    if (!dragRef.current) return;
    const next = { anchor: dragRef.current.anchor, hover: newLine };
    dragRef.current = next;
    setDrag(next);
  };

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

  const selection = drag
    ? { start: Math.min(drag.anchor, drag.hover), end: Math.max(drag.anchor, drag.hover) }
    : target
      ? { start: target.startLine ?? target.line, end: target.line }
      : null;

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

  const insertSuggestion = () => {
    if (!target || hasSuggestionBlock(body)) return;
    const startLine = target.startLine ?? target.line;
    const block = buildSuggestionBlock(currentLineContents(lines, lineMeta, startLine, target.line));
    setBody((current) => (current.trim() ? `${current.replace(/\n*$/, '')}\n\n${block}` : block));
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

  const renderRow = (lineIndex: number): ReactNode => {
    const text = lines[lineIndex];
    const { oldLine, newLine } = lineMeta[lineIndex] ?? { oldLine: null, newLine: null };
    const commentable = newLine !== null;
    const isHeaderLine = oldLine === null && newLine === null;
    return (
      <>
        <div
          data-newline={newLine ?? ''}
          className={`flex ${lineBackground(text)} ${rangeBorders(newLine)}`}
        >
          <span className="relative w-6 shrink-0 select-none border-r border-slate-100 text-center text-slate-400 dark:border-slate-800">
            {commentable ? (
              <>
                <button
                  type="button"
                  title="Click to comment, or drag to select multiple lines"
                  onPointerDown={(event) => beginDrag(newLine, event)}
                  className="cursor-pointer font-semibold text-slate-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  +
                </button>
                <button
                  type="button"
                  title="Ask a local model about this line"
                  onClick={(event) => {
                    event.stopPropagation();
                    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-newline]');
                    if (!row) return;
                    const rect = row.getBoundingClientRect();
                    const anchorRect = { top: rect.top, bottom: rect.bottom, left: rect.left };
                    const context = buildCodeContext(lines, lineMeta, target ?? { line: newLine });
                    setAiChat({ anchorRect, code: context.code, label: context.label, anchorLine: newLine });
                    setAiChatOpen(true);
                  }}
                  className={`absolute left-full top-1/2 z-10 ml-0.5 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 ${
                    target?.line === newLine || aiChat?.anchorLine === newLine
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M3.5 12.5l1.5-1.5M11 5l1.5-1.5" />
                    <circle cx="8" cy="8" r="2" />
                  </svg>
                </button>
              </>
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
          <span className="flex-1 whitespace-pre-wrap break-words px-3">
            {isHeaderLine ? text || ' ' : <DiffCode text={text} language={language} />}
          </span>
        </div>

        {lineThreads
          .filter((thread) => thread.line === newLine)
          .map((thread) => (
            <ExistingReviewThread
              key={thread.id}
              thread={thread}
              onThreadsChange={onThreadsChange}
              setStatus={setStatus}
            />
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
            {hasSuggestionBlock(body) ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Suggestion block added — edit the replacement inside the{' '}
                <span className="font-mono">```suggestion</span> fence.
              </span>
            ) : null}
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
                onClick={insertSuggestion}
                disabled={hasSuggestionBlock(body)}
                title="Prefill a GitHub suggestion with the current line content"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Suggest change
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
      </>
    );
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

      {lines.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualizedDiff
          rowCount={lines.length}
          renderRow={renderRow}
          trackDrag={trackDrag}
          dragging={drag !== null}
          scrollRef={scrollContainerRef}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          onPointerMove={trackDrag}
          className={`overflow-auto rounded-md border border-slate-200 font-mono text-[13px] leading-6 dark:border-slate-700 ${
            drag ? 'select-none' : ''
          }`}
        >
          {lines.map((_, lineIndex) => (
            <div key={lineIndex} className="group">
              {renderRow(lineIndex)}
            </div>
          ))}
        </div>
      )}

      {aiChat && (
        <AiChatPopup
          key={aiChat.anchorLine}
          anchorRect={aiChat.anchorRect}
          scrollContainer={scrollContainerRef.current}
          contextCode={aiChat.code}
          contextLabel={aiChat.label}
          onClose={() => {
            setAiChat(null);
            useAiChatOpen.getState().setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function VirtualizedDiff({
  rowCount,
  renderRow,
  trackDrag,
  dragging,
  scrollRef,
}: {
  rowCount: number;
  renderRow: (lineIndex: number) => ReactNode;
  trackDrag: (event: ReactPointerEvent) => void;
  dragging: boolean;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 24,
  });

  return (
    <div
      ref={scrollRef}
      onPointerMove={trackDrag}
      className={`max-h-[70vh] overflow-auto rounded-md border border-slate-200 font-mono text-[13px] leading-6 dark:border-slate-700 ${
        dragging ? 'select-none' : ''
      }`}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="group"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
