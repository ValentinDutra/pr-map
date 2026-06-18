import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Result, err, ok, isOk } from './result.js';
import type { GhClient, GhError, ReviewEvent, ReviewSubmission } from './gh-client.js';
import type {
  ChecksSummary,
  CommentScope,
  CommentSide,
  CommitInfo,
  ExistingConversationComment,
  ExistingReviewComment,
  ReviewState,
  ReviewThread,
} from './types.js';

export interface ReviewStore {
  load(): Promise<ReviewState>;
  update(mutator: (state: ReviewState) => ReviewState): Promise<ReviewState>;
  clear(): Promise<void>;
}

export interface AddCommentInput {
  scope: CommentScope;
  path: string;
  line?: number;
  startLine?: number;
  side?: CommentSide;
  startSide?: CommentSide;
  body: string;
}

// --- Operations (the testable core; the router is thin wiring over these) ---

export function addComment(
  store: ReviewStore,
  input: AddCommentInput,
  makeId: () => string,
): Promise<ReviewState> {
  return store.update((state) => ({
    ...state,
    comments: [...state.comments, { id: makeId(), ...input }],
  }));
}

export function removeComment(store: ReviewStore, id: string): Promise<ReviewState> {
  return store.update((state) => ({
    ...state,
    comments: state.comments.filter((comment) => comment.id !== id),
  }));
}

export function setSummary(store: ReviewStore, summaryBody: string): Promise<ReviewState> {
  return store.update((state) => ({ ...state, summaryBody }));
}

export function getPending(store: ReviewStore): Promise<ReviewState> {
  return store.load();
}

export interface ExistingDiscussion {
  reviewComments: ExistingReviewComment[];
  conversationComments: ExistingConversationComment[];
}

// The discussion already on the PR (read-only): inline review comments plus PR-level
// conversation comments, fetched from GitHub for the PR the store is tracking.
export async function getExisting(
  store: ReviewStore,
  ghClient: GhClient,
): Promise<Result<ExistingDiscussion, GhError>> {
  const state = await store.load();
  if (state.prNumber <= 0) {
    return err({
      message: 'PR number is unknown; regenerate graph.json before loading the discussion.',
    });
  }
  const reviewComments = await ghClient.listReviewComments(state.prNumber);
  if (!isOk(reviewComments)) return reviewComments;
  const conversationComments = await ghClient.listConversationComments(state.prNumber);
  if (!isOk(conversationComments)) return conversationComments;
  return ok({
    reviewComments: reviewComments.value,
    conversationComments: conversationComments.value,
  });
}

// The PR's review-comment threads (read-only structure plus their resolved state), for the PR
// the store is tracking. Resolving/unresolving a thread mutates the state these expose.
export async function getThreads(
  store: ReviewStore,
  ghClient: GhClient,
): Promise<Result<ReviewThread[], GhError>> {
  const state = await store.load();
  if (state.prNumber <= 0) {
    return err({
      message: 'PR number is unknown; regenerate graph.json before loading review threads.',
    });
  }
  return ghClient.listReviewThreads(state.prNumber);
}

// The CI/checks status for the head commit of the PR the store is tracking (read-only).
export async function getChecks(
  store: ReviewStore,
  ghClient: GhClient,
): Promise<Result<ChecksSummary, GhError>> {
  const state = await store.load();
  if (state.prNumber <= 0) {
    return err({
      message: 'PR number is unknown; regenerate graph.json before loading checks.',
    });
  }
  return ghClient.listChecks(state.prNumber);
}

// The commit list for the PR the store is tracking (read-only): sha, subject, author, date,
// and a link to each commit on GitHub.
export async function getCommits(
  store: ReviewStore,
  ghClient: GhClient,
): Promise<Result<CommitInfo[], GhError>> {
  const state = await store.load();
  if (state.prNumber <= 0) {
    return err({
      message: 'PR number is unknown; regenerate graph.json before loading commits.',
    });
  }
  return ghClient.listCommits(state.prNumber);
}

// The bulk review carries the verdict, the summary body, and line-scoped comments (with
// optional multi-line ranges). File-scoped comments are posted separately at submit time.
export function buildSubmission(
  state: ReviewState,
  event: ReviewEvent,
  summaryBody?: string,
): ReviewSubmission {
  const lineComments = state.comments.filter((comment) => comment.scope === 'line');
  return {
    event,
    body: summaryBody ?? state.summaryBody ?? '',
    comments: lineComments.map((comment) => ({
      path: comment.path,
      body: comment.body,
      ...(comment.line !== undefined ? { line: comment.line } : {}),
      ...(comment.side ? { side: comment.side } : {}),
      ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}),
      ...(comment.startSide ? { startSide: comment.startSide } : {}),
    })),
  };
}

export async function submitReview(
  store: ReviewStore,
  ghClient: GhClient,
  event: ReviewEvent,
  summaryBody?: string,
): Promise<Result<string, GhError>> {
  const state = await store.load();
  if (state.prNumber <= 0) {
    return err({
      message: 'PR number is unknown; regenerate graph.json before submitting a review.',
    });
  }

  const fileComments = state.comments.filter((comment) => comment.scope === 'file');
  const lineComments = state.comments.filter((comment) => comment.scope === 'line');
  const body = summaryBody ?? state.summaryBody ?? '';
  const hasReviewContent = body !== '' || lineComments.length > 0;

  // APPROVE may be empty; REQUEST_CHANGES always needs review content (GitHub requires a body);
  // COMMENT needs review content unless it is carried entirely by file-level comments.
  if (event === 'REQUEST_CHANGES' && !hasReviewContent) {
    return err({
      message: 'A REQUEST_CHANGES review needs a body or at least one line comment.',
    });
  }
  if (event === 'COMMENT' && !hasReviewContent && fileComments.length === 0) {
    return err({
      message: 'A COMMENT review needs a body or at least one comment.',
    });
  }

  // File-level comments are rejected by the bulk reviews endpoint, so post them individually
  // against the head commit before submitting the review. Each one is removed from the pending
  // store the moment it posts, so a resubmit after a later failure never double-posts it.
  if (fileComments.length > 0) {
    const headSha = await ghClient.getHeadSha(state.prNumber);
    if (!isOk(headSha)) return headSha;
    for (const fileComment of fileComments) {
      const posted = await ghClient.createFileComment(
        state.prNumber,
        headSha.value,
        fileComment.path,
        fileComment.body,
      );
      if (!isOk(posted)) return posted;
      await store.update((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== fileComment.id),
      }));
    }
  }

  if (event === 'APPROVE' || hasReviewContent) {
    const submission = buildSubmission(state, event, body);
    const result = await ghClient.createReview(state.prNumber, submission);
    if (!isOk(result)) return result;
  }

  await store.clear();
  return ok('submitted');
}

// --- File-backed store: serialized mutations + atomic writes (thin fs glue) ---

export function createFileReviewStore(dataDir: string, prNumber: number): ReviewStore {
  const filePath = join(dataDir, 'pending-review.json');
  let chain: Promise<unknown> = Promise.resolve();

  const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const readState = async (): Promise<ReviewState> => {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as ReviewState;
      // Guard against structurally-valid JSON with the wrong shape (e.g. a hand-edited file
      // missing `comments`): a non-array would make a later `[...state.comments]` throw.
      if (!Array.isArray(parsed.comments)) {
        console.warn(`pr-map: ${filePath} has no comments array; starting a fresh pending review.`);
        return { prNumber, comments: [] };
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`pr-map: could not read ${filePath}; starting a fresh pending review.`);
      }
      return { prNumber, comments: [] };
    }
  };

  const writeState = async (state: ReviewState): Promise<void> => {
    await mkdir(dataDir, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, filePath);
  };

  return {
    load: () => runExclusive(readState),
    update: (mutator) =>
      runExclusive(async () => {
        const next = mutator(await readState());
        await writeState(next);
        return next;
      }),
    clear: () => runExclusive(() => writeState({ prNumber, comments: [] })),
  };
}

// --- Router (thin wiring; async handlers are guarded so rejections never hang) ---

export interface ReviewRouterDeps {
  ghClient: GhClient;
  store: ReviewStore;
  makeId?: () => string;
}

type AsyncHandler = (request: Request, response: Response) => Promise<void>;

function wrap(handler: AsyncHandler) {
  return (request: Request, response: Response): void => {
    handler(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        response.status(500).json({ error: (error as Error).message });
      }
    });
  };
}

export function createReviewRouter(deps: ReviewRouterDeps): Router {
  const makeId = deps.makeId ?? (() => randomUUID());
  const router = Router();

  router.post(
    '/comment',
    wrap(async (request, response) => {
      const { scope, path, line, startLine, side, startSide, body } =
        request.body as Partial<AddCommentInput>;
      if (!body) {
        response.status(400).json({ error: 'body is required' });
        return;
      }
      if (scope !== 'line' && scope !== 'file') {
        response.status(400).json({ error: "scope must be 'line' or 'file'" });
        return;
      }
      if (!path) {
        response.status(400).json({ error: 'path is required' });
        return;
      }
      if (scope === 'line' && line === undefined) {
        response.status(400).json({ error: 'line is required for a line comment' });
        return;
      }
      if (startLine !== undefined && line !== undefined && startLine > line) {
        response.status(400).json({ error: 'startLine must be <= line' });
        return;
      }
      const state = await addComment(
        deps.store,
        { scope, path, line, startLine, side, startSide, body },
        makeId,
      );
      response.json(state);
    }),
  );

  router.get(
    '/pending',
    wrap(async (_request, response) => {
      response.json(await getPending(deps.store));
    }),
  );

  router.delete(
    '/comment/:id',
    wrap(async (request, response) => {
      response.json(await removeComment(deps.store, request.params.id));
    }),
  );

  router.put(
    '/summary',
    wrap(async (request, response) => {
      const { body } = request.body as { body?: string };
      response.json(await setSummary(deps.store, body ?? ''));
    }),
  );

  router.post(
    '/conversation',
    wrap(async (request, response) => {
      const { body } = request.body as { body?: string };
      if (!body) {
        response.status(400).json({ error: 'body is required' });
        return;
      }
      const state = await deps.store.load();
      if (state.prNumber <= 0) {
        response.status(400).json({
          error: 'PR number is unknown; regenerate graph.json before posting a comment.',
        });
        return;
      }
      const result = await deps.ghClient.createConversationComment(state.prNumber, body);
      if (isOk(result)) {
        response.json({ ok: true });
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  router.post(
    '/reply',
    wrap(async (request, response) => {
      const { commentId, body } = request.body as { commentId?: number; body?: string };
      if (!Number.isInteger(commentId) || !body) {
        response.status(400).json({ error: 'an integer commentId and a body are required' });
        return;
      }
      const state = await deps.store.load();
      if (state.prNumber <= 0) {
        response.status(400).json({
          error: 'PR number is unknown; regenerate graph.json before replying.',
        });
        return;
      }
      const result = await deps.ghClient.replyToComment(state.prNumber, commentId as number, body);
      if (isOk(result)) {
        response.json({ ok: true });
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  router.post(
    '/submit',
    wrap(async (request, response) => {
      const { event, body } = request.body as { event?: ReviewEvent; body?: string };
      if (!event) {
        response.status(400).json({ error: 'event is required' });
        return;
      }
      const result = await submitReview(deps.store, deps.ghClient, event, body);
      if (isOk(result)) {
        response.json({ ok: true });
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  return router;
}

// Mounted at /api/existing: serves the PR's already-posted discussion (read-only). It shares
// the review deps so it reads the same PR number the review routes write against.
export function createExistingRouter(deps: ReviewRouterDeps): Router {
  const router = Router();

  router.get(
    '/',
    wrap(async (_request, response) => {
      const result = await getExisting(deps.store, deps.ghClient);
      if (isOk(result)) {
        response.json(result.value);
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  return router;
}

// Mounted at /api/checks: serves the PR's CI/checks status (read-only). It shares the review
// deps so it reads the same PR number the review routes write against.
export function createChecksRouter(deps: ReviewRouterDeps): Router {
  const router = Router();

  router.get(
    '/',
    wrap(async (_request, response) => {
      const result = await getChecks(deps.store, deps.ghClient);
      if (isOk(result)) {
        response.json(result.value);
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  return router;
}

// Mounted at /api/commits: serves the PR's commit list (read-only). It shares the review
// deps so it reads the same PR number the review routes write against.
export function createCommitsRouter(deps: ReviewRouterDeps): Router {
  const router = Router();

  router.get(
    '/',
    wrap(async (_request, response) => {
      const result = await getCommits(deps.store, deps.ghClient);
      if (isOk(result)) {
        response.json(result.value);
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  return router;
}

// Mounted at /api/threads: serves the PR's review-comment threads and their resolved state, and
// accepts resolve/unresolve mutations by thread id. It shares the review deps so it reads the
// same PR number the review routes write against.
export function createThreadsRouter(deps: ReviewRouterDeps): Router {
  const router = Router();

  router.get(
    '/',
    wrap(async (_request, response) => {
      const result = await getThreads(deps.store, deps.ghClient);
      if (isOk(result)) {
        response.json(result.value);
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  router.post(
    '/:id/resolve',
    wrap(async (request, response) => {
      const result = await deps.ghClient.resolveReviewThread(request.params.id);
      if (isOk(result)) {
        response.json({ ok: true });
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  router.post(
    '/:id/unresolve',
    wrap(async (request, response) => {
      const result = await deps.ghClient.unresolveReviewThread(request.params.id);
      if (isOk(result)) {
        response.json({ ok: true });
      } else {
        response.status(502).json({ error: result.error.message });
      }
    }),
  );

  return router;
}
