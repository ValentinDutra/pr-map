import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Result, err, ok, isOk } from './result.js';
import type { GhClient, GhError, ReviewEvent, ReviewSubmission } from './gh-client.js';
import type { CommentScope, CommentSide, ReviewState } from './types.js';

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
  // against the head commit before submitting the review.
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
      return JSON.parse(await readFile(filePath, 'utf8')) as ReviewState;
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
