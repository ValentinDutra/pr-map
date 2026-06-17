import { describe, it, expect } from 'vitest';
import {
  addComment,
  buildSubmission,
  submitReview,
  type ReviewStore,
} from './review-endpoints.js';
import { ok, err, type Result } from './result.js';
import type { GhClient, GhError, ReviewSubmission } from './gh-client.js';
import type { ReviewState } from './types.js';

function memoryStore(prNumber: number): ReviewStore {
  let state: ReviewState = { prNumber, comments: [] };
  return {
    load: () => Promise.resolve(state),
    update: (mutator) => {
      state = mutator(state);
      return Promise.resolve(state);
    },
    clear: () => {
      state = { prNumber, comments: [] };
      return Promise.resolve();
    },
  };
}

function fakeGhClient(
  createReviewResult: Result<string, GhError>,
): { client: GhClient; submissions: { prNumber: number; submission: ReviewSubmission }[] } {
  const submissions: { prNumber: number; submission: ReviewSubmission }[] = [];
  const client = {
    createReview: (prNumber: number, submission: ReviewSubmission) => {
      submissions.push({ prNumber, submission });
      return Promise.resolve(createReviewResult);
    },
  } as unknown as GhClient;
  return { client, submissions };
}

function sequentialIds(): () => string {
  let counter = 0;
  return () => `id-${(counter += 1)}`;
}

describe('addComment', () => {
  it('accumulates comments and persists them in the store', async () => {
    const store = memoryStore(7);
    const makeId = sequentialIds();

    await addComment(store, { path: 'a.ts', line: 5, body: 'first' }, makeId);
    const state = await addComment(store, { path: 'a.ts', line: 9, body: 'second' }, makeId);

    expect(state.comments).toHaveLength(2);
    expect((await store.load()).comments.map((comment) => comment.body)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('buildSubmission', () => {
  it('routes inline comments to the comments array and general comments to the body', () => {
    const state: ReviewState = {
      prNumber: 7,
      comments: [
        { id: '1', path: 'a.ts', line: 5, side: 'RIGHT', body: 'inline note' },
        { id: '2', path: '', body: 'overall this looks good' },
      ],
    };

    const submission = buildSubmission(state, 'COMMENT');

    expect(submission.comments).toEqual([
      { path: 'a.ts', line: 5, side: 'RIGHT', body: 'inline note' },
    ]);
    expect(submission.body).toBe('overall this looks good');
    expect(submission.event).toBe('COMMENT');
  });
});

describe('submitReview', () => {
  it('calls createReview and clears pending on success', async () => {
    const store = memoryStore(7);
    await addComment(store, { path: 'a.ts', line: 5, body: 'inline' }, sequentialIds());
    const { client, submissions } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'APPROVE');

    expect(result.ok).toBe(true);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].prNumber).toBe(7);
    expect(submissions[0].submission.event).toBe('APPROVE');
    expect((await store.load()).comments).toHaveLength(0);
  });

  it('keeps pending comments when createReview fails', async () => {
    const store = memoryStore(7);
    await addComment(store, { path: 'a.ts', line: 5, body: 'inline' }, sequentialIds());
    const { client } = fakeGhClient(err({ message: 'rejected' }));

    const result = await submitReview(store, client, 'APPROVE');

    expect(result.ok).toBe(false);
    expect((await store.load()).comments).toHaveLength(1);
  });

  it('refuses an empty COMMENT review without calling GitHub', async () => {
    const store = memoryStore(7);
    const { client, submissions } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'COMMENT');

    expect(result.ok).toBe(false);
    expect(submissions).toHaveLength(0);
  });

  it('refuses to submit when the PR number is unknown', async () => {
    const store = memoryStore(0);
    await addComment(store, { path: 'a.ts', line: 1, body: 'x' }, sequentialIds());
    const { client, submissions } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'COMMENT');

    expect(result.ok).toBe(false);
    expect(submissions).toHaveLength(0);
  });
});
