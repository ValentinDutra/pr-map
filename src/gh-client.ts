import { spawn } from 'node:child_process';
import { type Result, ok, err, isOk } from './result.js';
import { retry, type RetryOptions } from './retry.js';
import type {
  CheckRun,
  ChecksSummary,
  CommentSide,
  CommitInfo,
  ExistingConversationComment,
  ExistingReviewComment,
  NodeStatus,
  PrMeta,
  ReviewThread,
} from './types.js';

export interface GhError {
  message: string;
  stderr?: string;
  exitCode?: number;
}

export type CommandExecutor = (
  args: string[],
  stdin?: string,
) => Promise<Result<string, GhError>>;

export interface ChangedFile {
  path: string;
  status: NodeStatus;
  additions: number;
  deletions: number;
  patch?: string;
  previousPath?: string;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewComment {
  path: string;
  line?: number;
  side?: CommentSide;
  startLine?: number;
  startSide?: CommentSide;
  body: string;
}

export interface ReviewSubmission {
  event: ReviewEvent;
  body?: string;
  comments: ReviewComment[];
}

export interface GhClient {
  getPrMetadata(ref: string): Promise<Result<PrMeta, GhError>>;
  listChangedFiles(prNumber: number): Promise<Result<ChangedFile[], GhError>>;
  getDiff(ref: string): Promise<Result<string, GhError>>;
  getFileContent(path: string, ref: string): Promise<Result<string, GhError>>;
  createReview(
    prNumber: number,
    submission: ReviewSubmission,
  ): Promise<Result<string, GhError>>;
  replyToComment(
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<Result<string, GhError>>;
  getHeadSha(prNumber: number): Promise<Result<string, GhError>>;
  createFileComment(
    prNumber: number,
    commitId: string,
    path: string,
    body: string,
  ): Promise<Result<string, GhError>>;
  createConversationComment(
    prNumber: number,
    body: string,
  ): Promise<Result<string, GhError>>;
  listReviewComments(
    prNumber: number,
  ): Promise<Result<ExistingReviewComment[], GhError>>;
  listConversationComments(
    prNumber: number,
  ): Promise<Result<ExistingConversationComment[], GhError>>;
  listReviewThreads(
    prNumber: number,
  ): Promise<Result<ReviewThread[], GhError>>;
  resolveReviewThread(threadId: string): Promise<Result<string, GhError>>;
  unresolveReviewThread(threadId: string): Promise<Result<string, GhError>>;
  listChecks(prNumber: number): Promise<Result<ChecksSummary, GhError>>;
  listCommits(prNumber: number): Promise<Result<CommitInfo[], GhError>>;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = { attempts: 3, delayMs: 300 };

const PR_METADATA_FIELDS =
  'number,title,body,author,baseRefName,headRefName,url';

// Review threads are a GraphQL-only concept (the REST comments list has no thread grouping and
// no resolved state), so this query reads the thread structure plus each thread's comments.
const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              databaseId
              body
              createdAt
              path
              line
              originalLine
              author { login }
            }
          }
        }
      }
    }
  }
}`;

// Resolving/unresolving a thread is a GraphQL-only mutation keyed by the thread's node id.
const RESOLVE_THREAD_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

const UNRESOLVE_THREAD_MUTATION = `mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

export function createGhClient(
  execute: CommandExecutor,
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
): GhClient {
  const run = (args: string[], stdin?: string): Promise<Result<string, GhError>> =>
    retry(() => execute(args, stdin), retryOptions);

  // Reads are retried (idempotent). Writes/mutations are NOT retried: gh can exit non-zero on a
  // transient error after GitHub already created the resource, so a retry would post a duplicate
  // review or comment. A failed write surfaces to the user, who can retry it deliberately.
  const runWrite = (args: string[], stdin?: string): Promise<Result<string, GhError>> =>
    execute(args, stdin);

  return {
    async getPrMetadata(ref) {
      const args = ['pr', 'view'];
      if (ref) args.push(ref);
      args.push('--json', PR_METADATA_FIELDS);
      const raw = await run(args);
      if (!isOk(raw)) return raw;
      return parsePrMetadata(raw.value);
    },

    async listChangedFiles(prNumber) {
      const raw = await run([
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/files`,
        '--paginate',
      ]);
      if (!isOk(raw)) return raw;
      return parseChangedFiles(raw.value);
    },

    getDiff(ref) {
      const args = ['pr', 'diff'];
      if (ref) args.push(ref);
      return run(args);
    },

    getFileContent(path, ref) {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      return run([
        'api',
        `repos/{owner}/{repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        '-H',
        'Accept: application/vnd.github.raw',
      ]);
    },

    createReview(prNumber, submission) {
      return runWrite(
        [
          'api',
          `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
          '--method',
          'POST',
          '--input',
          '-',
        ],
        JSON.stringify({
          event: submission.event,
          body: submission.body ?? '',
          comments: submission.comments.map((comment) => ({
            path: comment.path,
            body: comment.body,
            ...(comment.line !== undefined ? { line: comment.line } : {}),
            ...(comment.side ? { side: comment.side } : {}),
            ...(comment.startLine !== undefined ? { start_line: comment.startLine } : {}),
            ...(comment.startSide ? { start_side: comment.startSide } : {}),
          })),
        }),
      );
    },

    replyToComment(prNumber, commentId, body) {
      return runWrite(
        [
          'api',
          `repos/{owner}/{repo}/pulls/${prNumber}/comments/${commentId}/replies`,
          '--method',
          'POST',
          '--input',
          '-',
        ],
        JSON.stringify({ body }),
      );
    },

    async getHeadSha(prNumber) {
      const raw = await run([
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}`,
        '--jq',
        '.head.sha',
      ]);
      if (!isOk(raw)) return raw;
      return ok(raw.value.trim());
    },

    // File-level comments are not accepted by the bulk reviews endpoint, so they go through
    // the standalone review-comment endpoint, which needs the head commit_id and subject_type.
    createFileComment(prNumber, commitId, path, body) {
      return runWrite(
        [
          'api',
          `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
          '--method',
          'POST',
          '--input',
          '-',
        ],
        JSON.stringify({ commit_id: commitId, path, subject_type: 'file', body }),
      );
    },

    createConversationComment(prNumber, body) {
      return runWrite(
        [
          'api',
          `repos/{owner}/{repo}/issues/${prNumber}/comments`,
          '--method',
          'POST',
          '--input',
          '-',
        ],
        JSON.stringify({ body }),
      );
    },

    async listReviewComments(prNumber) {
      const raw = await run([
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--paginate',
      ]);
      if (!isOk(raw)) return raw;
      return parseReviewComments(raw.value);
    },

    async listConversationComments(prNumber) {
      const raw = await run([
        'api',
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        '--paginate',
      ]);
      if (!isOk(raw)) return raw;
      return parseConversationComments(raw.value);
    },

    // Review threads (the resolved/unresolved grouping) only exist in GraphQL. The {owner}/{repo}
    // placeholders are populated by gh from the current repository, the same context the REST
    // calls above rely on, so this method needs nothing beyond the PR number.
    async listReviewThreads(prNumber) {
      const raw = await run([
        'api',
        'graphql',
        '-F',
        'owner={owner}',
        '-F',
        'name={repo}',
        '-F',
        `number=${prNumber}`,
        '-f',
        `query=${REVIEW_THREADS_QUERY}`,
      ]);
      if (!isOk(raw)) return raw;
      return parseReviewThreads(raw.value);
    },

    resolveReviewThread(threadId) {
      return runWrite([
        'api',
        'graphql',
        '-F',
        `threadId=${threadId}`,
        '-f',
        `query=${RESOLVE_THREAD_MUTATION}`,
      ]);
    },

    unresolveReviewThread(threadId) {
      return runWrite([
        'api',
        'graphql',
        '-F',
        `threadId=${threadId}`,
        '-f',
        `query=${UNRESOLVE_THREAD_MUTATION}`,
      ]);
    },

    // Checks live in two GitHub surfaces: the check-runs API (GitHub Actions, App checks)
    // and the legacy combined-status API (commit statuses). Both hang off the head commit,
    // so resolve the SHA first, then merge the two responses into one normalized summary.
    // gh api always exits 0 on success, unlike `gh pr checks` which exits non-zero on
    // pending/failing checks and would surface as a GhError.
    async listChecks(prNumber) {
      const headSha = await this.getHeadSha(prNumber);
      if (!isOk(headSha)) return headSha;
      const sha = headSha.value;

      const checkRunsRaw = await run([
        'api',
        `repos/{owner}/{repo}/commits/${sha}/check-runs`,
        '--paginate',
      ]);
      if (!isOk(checkRunsRaw)) return checkRunsRaw;

      const combinedStatusRaw = await run([
        'api',
        `repos/{owner}/{repo}/commits/${sha}/status`,
      ]);
      if (!isOk(combinedStatusRaw)) return combinedStatusRaw;

      return parseChecks(checkRunsRaw.value, combinedStatusRaw.value);
    },

    async listCommits(prNumber) {
      const raw = await run([
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/commits`,
        '--paginate',
      ]);
      if (!isOk(raw)) return raw;
      return parseCommits(raw.value);
    },
  };
}

interface RawPrMetadata {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  baseRefName: string;
  headRefName: string;
  url: string;
}

interface RawChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

function parsePrMetadata(raw: string): Result<PrMeta, GhError> {
  const parsed = parseJson<RawPrMetadata>(raw);
  if (!isOk(parsed)) return parsed;
  const location = parseRepoFromUrl(parsed.value.url);
  if (!isOk(location)) return location;
  return ok({
    owner: location.value.owner,
    repo: location.value.repo,
    number: parsed.value.number,
    title: parsed.value.title,
    description: parsed.value.body ?? '',
    author: parsed.value.author?.login ?? '',
    baseRef: parsed.value.baseRefName,
    headRef: parsed.value.headRefName,
  });
}

interface RawReviewComment {
  id: number;
  path: string;
  line: number | null;
  original_line: number | null;
  side: string | null;
  body: string;
  user: { login: string } | null;
  created_at: string;
  in_reply_to_id?: number;
}

interface RawConversationComment {
  id: number;
  body: string;
  user: { login: string } | null;
  created_at: string;
}

function parseReviewComments(raw: string): Result<ExistingReviewComment[], GhError> {
  const parsed = parseJson<RawReviewComment[]>(raw);
  if (!isOk(parsed)) return parsed;
  return ok(
    parsed.value.map((comment) => ({
      id: comment.id,
      path: comment.path,
      // GitHub returns line on the current diff, falling back to original_line when the
      // commented line is outdated against the latest push.
      line: comment.line ?? comment.original_line,
      side: comment.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: comment.body,
      author: comment.user?.login ?? '',
      createdAt: comment.created_at,
      inReplyToId: comment.in_reply_to_id ?? null,
    })),
  );
}

function parseConversationComments(
  raw: string,
): Result<ExistingConversationComment[], GhError> {
  const parsed = parseJson<RawConversationComment[]>(raw);
  if (!isOk(parsed)) return parsed;
  return ok(
    parsed.value.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.user?.login ?? '',
      createdAt: comment.created_at,
    })),
  );
}

interface RawReviewThreadComment {
  databaseId: number | null;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  author: { login: string } | null;
}

interface RawReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: RawReviewThreadComment[] };
}

interface RawReviewThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: RawReviewThread[] };
      } | null;
    } | null;
  };
}

function parseReviewThreads(raw: string): Result<ReviewThread[], GhError> {
  const parsed = parseJson<RawReviewThreadsResponse>(raw);
  if (!isOk(parsed)) return parsed;
  const nodes = parsed.value.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!nodes) {
    return err({ message: 'GraphQL response did not contain review threads.' });
  }
  return ok(
    nodes.map((thread) => {
      const firstComment = thread.comments.nodes[0];
      return {
        id: thread.id,
        isResolved: thread.isResolved,
        // Every comment in a thread shares the same path; take it from the first one.
        path: firstComment?.path ?? '',
        // The thread anchors to the first comment's current-diff line, falling back to the
        // original line when the line is outdated against the latest push.
        line: firstComment ? firstComment.line ?? firstComment.originalLine : null,
        comments: thread.comments.nodes.map((comment) => ({
          id: comment.databaseId,
          author: comment.author?.login ?? '',
          body: comment.body,
          createdAt: comment.createdAt,
        })),
      };
    }),
  );
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
  author: { login: string } | null;
}

function parseCommits(raw: string): Result<CommitInfo[], GhError> {
  const parsed = parseJson<RawCommit[]>(raw);
  if (!isOk(parsed)) return parsed;
  return ok(
    parsed.value.map((commit) => ({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      // Only the subject line; the body (after the first newline) is dropped for the list view.
      message: commit.commit.message.split('\n')[0],
      // The git-author name from the commit, falling back to the GitHub login when absent.
      author: commit.commit.author?.name ?? commit.author?.login ?? '',
      date: commit.commit.author?.date ?? '',
      url: commit.html_url,
    })),
  );
}

interface RawCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  details_url?: string | null;
}

interface RawCheckRunsResponse {
  check_runs: RawCheckRun[];
}

interface RawCombinedStatus {
  state: string;
  statuses: {
    context: string;
    state: string;
    target_url: string | null;
  }[];
}

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
]);

function parseChecks(
  checkRunsRaw: string,
  combinedStatusRaw: string,
): Result<ChecksSummary, GhError> {
  const checkRunsParsed = parseJson<RawCheckRunsResponse>(checkRunsRaw);
  if (!isOk(checkRunsParsed)) return checkRunsParsed;
  const combinedParsed = parseJson<RawCombinedStatus>(combinedStatusRaw);
  if (!isOk(combinedParsed)) return combinedParsed;

  const checks: CheckRun[] = [
    ...(checkRunsParsed.value.check_runs ?? []).map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? '',
      url: run.html_url ?? run.details_url ?? null,
    })),
    ...(combinedParsed.value.statuses ?? []).map((status) => ({
      name: status.context,
      // Legacy statuses have no lifecycle field; map their state onto status/conclusion so the
      // rollup treats a pending status as in-flight and a non-pending one as completed.
      status: status.state === 'pending' ? 'in_progress' : 'completed',
      conclusion: status.state === 'pending' ? '' : status.state,
      url: status.target_url ?? null,
    })),
  ];

  return ok({ state: computeOverallState(checks, combinedParsed.value.state), checks });
}

function computeOverallState(
  checks: CheckRun[],
  combinedState: string,
): ChecksSummary['state'] {
  const anyPending =
    combinedState === 'pending' ||
    checks.some((check) => check.status === 'queued' || check.status === 'in_progress');
  if (anyPending) return 'pending';

  const anyFailure =
    combinedState === 'failure' ||
    checks.some((check) => FAILURE_CONCLUSIONS.has(check.conclusion));
  if (anyFailure) return 'failure';

  return 'success';
}

function parseChangedFiles(raw: string): Result<ChangedFile[], GhError> {
  const parsed = parseJson<RawChangedFile[]>(raw);
  if (!isOk(parsed)) return parsed;
  return ok(
    parsed.value.map((file) => ({
      path: file.filename,
      status: mapStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      previousPath: file.previous_filename,
    })),
  );
}

function mapStatus(githubStatus: string): NodeStatus {
  switch (githubStatus) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

function parseRepoFromUrl(
  url: string,
): Result<{ owner: string; repo: string }, GhError> {
  // Host-agnostic so GitHub Enterprise URLs parse too.
  const match = /([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
  if (!match) {
    return err({ message: `Could not parse owner/repo from PR url: ${url}` });
  }
  return ok({ owner: match[1], repo: match[2] });
}

function parseJson<T>(raw: string): Result<T, GhError> {
  try {
    return ok(JSON.parse(raw) as T);
  } catch (error) {
    return err({
      message: `Failed to parse gh JSON output: ${(error as Error).message}`,
    });
  }
}

export function createDefaultExecutor(): CommandExecutor {
  return (args, stdin) =>
    new Promise<Result<string, GhError>>((resolve) => {
      const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => resolve(err({ message: error.message })));
      child.on('close', (code) => {
        if (code === 0) {
          resolve(ok(stdout));
        } else {
          resolve(
            err({
              message: `gh ${args.join(' ')} exited with code ${code ?? 'null'}`,
              stderr,
              exitCode: code ?? undefined,
            }),
          );
        }
      });
      // Guard against an async stream error (e.g. EPIPE when gh exits early) so it
      // surfaces as a Result via the 'error'/'close' handlers instead of crashing.
      child.stdin.on('error', () => undefined);
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
}
