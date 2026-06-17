import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Result, isOk } from './result.js';
import type {
  GhClient,
  GhError,
  ReviewEvent,
  ReviewSubmission,
} from './gh-client.js';
import type { PendingComment, ReviewState } from './types.js';

export interface ReviewStore {
  load(): Promise<ReviewState>;
  save(state: ReviewState): Promise<void>;
  clear(): Promise<void>;
}

export interface AddCommentInput {
  path: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
}

// --- Operations (the testable core; the router is thin wiring over these) ---

export async function addComment(
  store: ReviewStore,
  input: AddCommentInput,
  makeId: () => string,
): Promise<ReviewState> {
  const state = await store.load();
  const comment: PendingComment = { id: makeId(), ...input };
  const next: ReviewState = { ...state, comments: [...state.comments, comment] };
  await store.save(next);
  return next;
}

export async function removeComment(
  store: ReviewStore,
  id: string,
): Promise<ReviewState> {
  const state = await store.load();
  const next: ReviewState = {
    ...state,
    comments: state.comments.filter((comment) => comment.id !== id),
  };
  await store.save(next);
  return next;
}

export function getPending(store: ReviewStore): Promise<ReviewState> {
  return store.load();
}

export function buildSubmission(
  state: ReviewState,
  event: ReviewEvent,
  generalBody?: string,
): ReviewSubmission {
  const inline = state.comments.filter((comment) => comment.line !== undefined);
  const general = state.comments.filter((comment) => comment.line === undefined);
  const bodyParts = [generalBody ?? state.generalBody, ...general.map((c) => c.body)].filter(
    (part): part is string => Boolean(part),
  );
  return {
    event,
    body: bodyParts.join('\n\n'),
    comments: inline.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    })),
  };
}

export async function submitReview(
  store: ReviewStore,
  ghClient: GhClient,
  event: ReviewEvent,
  generalBody?: string,
): Promise<Result<string, GhError>> {
  const state = await store.load();
  const result = await ghClient.createReview(
    state.prNumber,
    buildSubmission(state, event, generalBody),
  );
  if (isOk(result)) {
    await store.clear();
  }
  return result;
}

// --- File-backed store (thin fs glue; tests use an in-memory store) ---

export function createFileReviewStore(dataDir: string, prNumber: number): ReviewStore {
  const filePath = join(dataDir, 'pending-review.json');
  return {
    async load() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as ReviewState;
      } catch {
        return { prNumber, comments: [] };
      }
    },
    async save(state) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
    },
    async clear() {
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        filePath,
        JSON.stringify({ prNumber, comments: [] }, null, 2),
        'utf8',
      );
    },
  };
}

// --- Router (thin wiring) ---

export interface ReviewRouterDeps {
  ghClient: GhClient;
  store: ReviewStore;
  makeId?: () => string;
}

export function createReviewRouter(deps: ReviewRouterDeps): Router {
  const makeId = deps.makeId ?? (() => randomUUID());
  const router = Router();

  router.post('/comment', async (request, response) => {
    const { path, line, side, body } = request.body as Partial<AddCommentInput>;
    if (!body) {
      response.status(400).json({ error: 'body is required' });
      return;
    }
    const state = await addComment(deps.store, { path: path ?? '', line, side, body }, makeId);
    response.json(state);
  });

  router.get('/pending', async (_request, response) => {
    response.json(await getPending(deps.store));
  });

  router.delete('/comment/:id', async (request, response) => {
    response.json(await removeComment(deps.store, request.params.id));
  });

  router.post('/reply', async (request, response) => {
    const { commentId, body } = request.body as { commentId?: number; body?: string };
    if (commentId === undefined || !body) {
      response.status(400).json({ error: 'commentId and body are required' });
      return;
    }
    const state = await deps.store.load();
    const result = await deps.ghClient.replyToComment(state.prNumber, commentId, body);
    if (isOk(result)) {
      response.json({ ok: true });
    } else {
      response.status(502).json({ error: result.error.message });
    }
  });

  router.post('/submit', async (request, response) => {
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
  });

  return router;
}
