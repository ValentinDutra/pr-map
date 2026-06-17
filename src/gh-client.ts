import { spawn } from 'node:child_process';
import { type Result, ok, err, isOk } from './result.js';
import { retry, type RetryOptions } from './retry.js';
import type { CommentSide, NodeStatus, PrMeta } from './types.js';

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
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = { attempts: 3, delayMs: 300 };

const PR_METADATA_FIELDS =
  'number,title,body,author,baseRefName,headRefName,url';

export function createGhClient(
  execute: CommandExecutor,
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
): GhClient {
  const run = (args: string[], stdin?: string): Promise<Result<string, GhError>> =>
    retry(() => execute(args, stdin), retryOptions);

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
      return run([
        'api',
        `repos/{owner}/{repo}/contents/${path}?ref=${ref}`,
        '-H',
        'Accept: application/vnd.github.raw',
      ]);
    },

    createReview(prNumber, submission) {
      return run(
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
          comments: submission.comments,
        }),
      );
    },

    replyToComment(prNumber, commentId, body) {
      return run(
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
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
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
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
}
