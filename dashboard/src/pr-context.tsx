import { useEffect, useState } from 'react';
import { reviewApi } from './review-api';
import { formatCommentTimestamp } from './format';
import type { ChecksState, ChecksSummary, CommitInfo, ExistingDiscussion } from './types';

const CHECKS_LABEL: Record<ChecksState, string> = {
  success: 'Checks passing',
  failure: 'Checks failing',
  pending: 'Checks pending',
};

const CHECKS_DOT: Record<ChecksState, string> = {
  success: 'bg-green-500',
  failure: 'bg-red-500',
  pending: 'bg-amber-500',
};

// A single check's state drives its dot color; failing conclusions and the in-flight lifecycle
// map to red/amber, everything settled and clean maps to green.
function checkStateColor(check: ChecksSummary['checks'][number]): string {
  if (check.status === 'queued' || check.status === 'in_progress' || check.conclusion === '') {
    return 'bg-amber-500';
  }
  if (check.conclusion === 'success' || check.conclusion === 'neutral' || check.conclusion === 'skipped') {
    return 'bg-green-500';
  }
  return 'bg-red-500';
}

// PR-wide context (commits + checks) that used to live in the header. In the sidebar a floating
// popover would overflow the narrow panel, so each row expands inline below itself instead.
type OpenSection = 'commits' | 'checks' | 'discussion' | null;

export function PrContextBar() {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [checks, setChecks] = useState<ChecksSummary | null>(null);
  const [discussion, setDiscussion] = useState<ExistingDiscussion | null>(null);
  const [open, setOpen] = useState<OpenSection>(null);

  useEffect(() => {
    let cancelled = false;
    // No commits/checks endpoint (static build) or nothing on the PR: leave each null and the
    // corresponding control hides itself.
    reviewApi
      .getCommits()
      .then((list) => {
        if (!cancelled) setCommits(list);
      })
      .catch(() => undefined);
    reviewApi
      .getChecks()
      .then((summary) => {
        if (!cancelled) setChecks(summary);
      })
      .catch(() => undefined);
    reviewApi
      .getExisting()
      .then((existing) => {
        if (!cancelled) setDiscussion(existing);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const hasCommits = commits !== null && commits.length > 0;
  // GitHub's combined-status endpoint reports `state: "pending"` for a commit with zero statuses,
  // so an empty checks list would otherwise render a perpetual "pending" — hide it instead.
  const hasChecks = checks !== null && checks.checks.length > 0;
  const hasDiscussion = discussion !== null && discussion.conversationComments.length > 0;
  if (!hasCommits && !hasChecks && !hasDiscussion) return null;

  const toggle = (section: Exclude<OpenSection, null>) =>
    setOpen((current) => (current === section ? null : section));

  return (
    <section className="flex flex-col gap-2 border-b border-slate-200 pb-3 text-xs dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {hasCommits ? (
          <button
            type="button"
            onClick={() => toggle('commits')}
            className="font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            {commits.length} commit{commits.length === 1 ? '' : 's'} {open === 'commits' ? '▾' : '▸'}
          </button>
        ) : null}
        {hasChecks ? (
          <button
            type="button"
            onClick={() => toggle('checks')}
            className="flex items-center gap-1.5 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${CHECKS_DOT[checks.state]}`} />
            {CHECKS_LABEL[checks.state]} {open === 'checks' ? '▾' : '▸'}
          </button>
        ) : null}
        {hasDiscussion ? (
          <button
            type="button"
            onClick={() => toggle('discussion')}
            className="font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            Discussion ({discussion.conversationComments.length}) {open === 'discussion' ? '▾' : '▸'}
          </button>
        ) : null}
      </div>

      {open === 'commits' && hasCommits ? (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-auto">
          {commits.map((commit) => (
            <div key={commit.sha} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <a
                  href={commit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-purple-700 hover:underline dark:text-purple-300"
                  title={commit.sha}
                >
                  {commit.shortSha}
                </a>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200" title={commit.message}>
                  {commit.message}
                </span>
              </div>
              <div className="flex items-baseline gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="truncate">{commit.author}</span>
                {commit.date ? <span className="shrink-0">{formatCommentTimestamp(commit.date)}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {open === 'checks' && hasChecks ? (
        <div className="flex max-h-64 flex-col gap-1 overflow-auto">
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

      {open === 'discussion' && hasDiscussion ? (
        <div className="flex max-h-64 flex-col gap-2 overflow-auto">
          {discussion.conversationComments.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-600 dark:text-slate-300">{comment.author}</span>
                <span>·</span>
                <span>{formatCommentTimestamp(comment.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
                {comment.body}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
