import { describe, it, expect } from 'vitest';
import {
  addComment,
  buildSubmission,
  getChecks,
  getCommits,
  getExisting,
  getThreads,
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

function fakeGhClient(createReviewResult: Result<string, GhError>): {
  client: GhClient;
  submissions: { prNumber: number; submission: ReviewSubmission }[];
  fileComments: { prNumber: number; commitId: string; path: string; body: string }[];
} {
  const submissions: { prNumber: number; submission: ReviewSubmission }[] = [];
  const fileComments: { prNumber: number; commitId: string; path: string; body: string }[] = [];
  const client = {
    createReview: (prNumber: number, submission: ReviewSubmission) => {
      submissions.push({ prNumber, submission });
      return Promise.resolve(createReviewResult);
    },
    getHeadSha: () => Promise.resolve(ok('sha-1')),
    createFileComment: (prNumber: number, commitId: string, path: string, body: string) => {
      fileComments.push({ prNumber, commitId, path, body });
      return Promise.resolve(ok(''));
    },
    createConversationComment: () => Promise.resolve(ok('')),
  } as unknown as GhClient;
  return { client, submissions, fileComments };
}

function sequentialIds(): () => string {
  let counter = 0;
  return () => `id-${(counter += 1)}`;
}

describe('addComment', () => {
  it('accumulates scoped comments and persists them in the store', async () => {
    const store = memoryStore(7);
    const makeId = sequentialIds();

    await addComment(store, { scope: 'line', path: 'a.ts', line: 5, body: 'first' }, makeId);
    const state = await addComment(
      store,
      { scope: 'file', path: 'a.ts', body: 'second' },
      makeId,
    );

    expect(state.comments).toHaveLength(2);
    expect(state.comments.map((comment) => comment.scope)).toEqual(['line', 'file']);
  });
});

describe('buildSubmission', () => {
  it('includes line comments and uses summaryBody as the body, excluding file comments', () => {
    const state: ReviewState = {
      prNumber: 7,
      comments: [
        { id: '1', scope: 'line', path: 'a.ts', line: 5, side: 'RIGHT', body: 'inline note' },
        { id: '2', scope: 'file', path: 'a.ts', body: 'file note' },
      ],
      summaryBody: 'overall this looks good',
    };

    const submission = buildSubmission(state, 'COMMENT');

    expect(submission.comments).toEqual([
      { path: 'a.ts', body: 'inline note', line: 5, side: 'RIGHT' },
    ]);
    expect(submission.body).toBe('overall this looks good');
    expect(submission.event).toBe('COMMENT');
  });

  it('carries multi-line range fields on a line comment', () => {
    const state: ReviewState = {
      prNumber: 7,
      comments: [
        {
          id: '1',
          scope: 'line',
          path: 'a.ts',
          line: 9,
          startLine: 5,
          side: 'RIGHT',
          startSide: 'RIGHT',
          body: 'range',
        },
      ],
    };

    const submission = buildSubmission(state, 'COMMENT', 'sum');

    expect(submission.comments[0]).toEqual({
      path: 'a.ts',
      body: 'range',
      line: 9,
      side: 'RIGHT',
      startLine: 5,
      startSide: 'RIGHT',
    });
    expect(submission.body).toBe('sum');
  });
});

describe('submitReview', () => {
  it('calls createReview and clears pending on success', async () => {
    const store = memoryStore(7);
    await addComment(store, { scope: 'line', path: 'a.ts', line: 5, body: 'inline' }, sequentialIds());
    const { client, submissions } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'APPROVE');

    expect(result.ok).toBe(true);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].submission.event).toBe('APPROVE');
    expect((await store.load()).comments).toHaveLength(0);
  });

  it('posts file comments via createFileComment using the head sha', async () => {
    const store = memoryStore(7);
    await addComment(store, { scope: 'file', path: 'a.ts', body: 'whole file' }, sequentialIds());
    const { client, submissions, fileComments } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'COMMENT');

    expect(result.ok).toBe(true);
    expect(fileComments).toEqual([
      { prNumber: 7, commitId: 'sha-1', path: 'a.ts', body: 'whole file' },
    ]);
    // A COMMENT carried entirely by a file comment needs no bulk review.
    expect(submissions).toHaveLength(0);
    expect((await store.load()).comments).toHaveLength(0);
  });

  it('keeps pending comments when createReview fails', async () => {
    const store = memoryStore(7);
    await addComment(store, { scope: 'line', path: 'a.ts', line: 5, body: 'inline' }, sequentialIds());
    const { client } = fakeGhClient(err({ message: 'rejected' }));

    const result = await submitReview(store, client, 'APPROVE');

    expect(result.ok).toBe(false);
    expect((await store.load()).comments).toHaveLength(1);
  });

  it('drops a file comment from the store once it posts, even if the review then fails', async () => {
    const store = memoryStore(7);
    const makeId = sequentialIds();
    await addComment(store, { scope: 'file', path: 'a.ts', body: 'whole-file note' }, makeId);
    await addComment(store, { scope: 'line', path: 'a.ts', line: 5, body: 'inline' }, makeId);
    const { client, fileComments } = fakeGhClient(err({ message: 'review rejected' }));

    const result = await submitReview(store, client, 'COMMENT');

    // The file comment posts exactly once; the review then fails; the posted file comment is
    // removed from the store so a resubmit re-posts the review but not the file comment.
    expect(fileComments).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect((await store.load()).comments.map((comment) => comment.scope)).toEqual(['line']);
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
    await addComment(store, { scope: 'line', path: 'a.ts', line: 1, body: 'x' }, sequentialIds());
    const { client, submissions } = fakeGhClient(ok('created'));

    const result = await submitReview(store, client, 'COMMENT');

    expect(result.ok).toBe(false);
    expect(submissions).toHaveLength(0);
  });
});

describe('getExisting', () => {
  it('returns the PR review and conversation comments for the tracked PR', async () => {
    const store = memoryStore(7);
    const calls: number[] = [];
    const client = {
      listReviewComments: (prNumber: number) => {
        calls.push(prNumber);
        return Promise.resolve(
          ok([
            {
              id: 1,
              path: 'a.ts',
              line: 5,
              side: 'RIGHT' as const,
              body: 'inline',
              author: 'octocat',
              createdAt: '2026-06-01T00:00:00Z',
              inReplyToId: null,
            },
          ]),
        );
      },
      listConversationComments: (prNumber: number) => {
        calls.push(prNumber);
        return Promise.resolve(
          ok([
            { id: 2, body: 'general', author: 'reviewer', createdAt: '2026-06-02T00:00:00Z' },
          ]),
        );
      },
    } as unknown as GhClient;

    const result = await getExisting(store, client);

    expect(calls).toEqual([7, 7]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewComments).toHaveLength(1);
      expect(result.value.conversationComments).toHaveLength(1);
    }
  });

  it('errors without calling GitHub when the PR number is unknown', async () => {
    const store = memoryStore(0);
    let called = false;
    const client = {
      listReviewComments: () => {
        called = true;
        return Promise.resolve(ok([]));
      },
      listConversationComments: () => Promise.resolve(ok([])),
    } as unknown as GhClient;

    const result = await getExisting(store, client);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('getThreads', () => {
  it('returns the review threads for the tracked PR', async () => {
    const store = memoryStore(7);
    const calls: number[] = [];
    const threads = [
      {
        id: 'PRRT_1',
        isResolved: false,
        path: 'a.ts',
        line: 5,
        comments: [{ id: 1, author: 'octocat', body: 'inline', createdAt: '2026-06-01T00:00:00Z' }],
      },
    ];
    const client = {
      listReviewThreads: (prNumber: number) => {
        calls.push(prNumber);
        return Promise.resolve(ok(threads));
      },
    } as unknown as GhClient;

    const result = await getThreads(store, client);

    expect(calls).toEqual([7]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(threads);
  });

  it('errors without calling GitHub when the PR number is unknown', async () => {
    const store = memoryStore(0);
    let called = false;
    const client = {
      listReviewThreads: () => {
        called = true;
        return Promise.resolve(ok([]));
      },
    } as unknown as GhClient;

    const result = await getThreads(store, client);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('getChecks', () => {
  it('returns the checks summary for the tracked PR', async () => {
    const store = memoryStore(7);
    const calls: number[] = [];
    const summary = {
      state: 'success' as const,
      checks: [{ name: 'unit', status: 'completed', conclusion: 'success', url: null }],
    };
    const client = {
      listChecks: (prNumber: number) => {
        calls.push(prNumber);
        return Promise.resolve(ok(summary));
      },
    } as unknown as GhClient;

    const result = await getChecks(store, client);

    expect(calls).toEqual([7]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(summary);
  });

  it('errors without calling GitHub when the PR number is unknown', async () => {
    const store = memoryStore(0);
    let called = false;
    const client = {
      listChecks: () => {
        called = true;
        return Promise.resolve(ok({ state: 'success', checks: [] }));
      },
    } as unknown as GhClient;

    const result = await getChecks(store, client);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('getCommits', () => {
  it('returns the commit list for the tracked PR', async () => {
    const store = memoryStore(7);
    const calls: number[] = [];
    const commits = [
      {
        sha: 'abc1234',
        shortSha: 'abc1234',
        message: 'Add discounts',
        author: 'octocat',
        date: '2026-06-01T00:00:00Z',
        url: 'https://github.com/acme/shop/commit/abc1234',
      },
    ];
    const client = {
      listCommits: (prNumber: number) => {
        calls.push(prNumber);
        return Promise.resolve(ok(commits));
      },
    } as unknown as GhClient;

    const result = await getCommits(store, client);

    expect(calls).toEqual([7]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(commits);
  });

  it('errors without calling GitHub when the PR number is unknown', async () => {
    const store = memoryStore(0);
    let called = false;
    const client = {
      listCommits: () => {
        called = true;
        return Promise.resolve(ok([]));
      },
    } as unknown as GhClient;

    const result = await getCommits(store, client);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
