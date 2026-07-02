import { describe, it, expect } from 'vitest';
import { fetchPr, workingDirKey } from './fetch-pr.js';
import { ok, err, isOk, type Result } from './result.js';
import type { ChangedFile, GhClient, GhError, ReviewSubmission } from './gh-client.js';
import type { PrMeta } from './types.js';

const baseMeta: PrMeta = {
  owner: 'acme',
  repo: 'shop',
  number: 7,
  title: 'Add discounts',
  description: 'body',
  author: 'octocat',
  baseRef: 'main',
  headRef: 'feature/discount',
  headSha: 'abc123sha',
};

interface FakeOptions {
  meta?: Result<PrMeta, GhError>;
  files?: Result<ChangedFile[], GhError>;
  diff?: Result<string, GhError>;
  contentByPath?: Record<string, Result<string, GhError>>;
}

function fakeGhClient(options: FakeOptions): {
  client: GhClient;
  contentCalls: { path: string; ref: string }[];
} {
  const contentCalls: { path: string; ref: string }[] = [];
  const client: GhClient = {
    getPrMetadata: () => Promise.resolve(options.meta ?? ok(baseMeta)),
    listChangedFiles: () => Promise.resolve(options.files ?? ok([])),
    getDiff: () => Promise.resolve(options.diff ?? ok('')),
    getFileContent: (path, ref) => {
      contentCalls.push({ path, ref });
      return Promise.resolve(options.contentByPath?.[path] ?? ok(`content:${path}`));
    },
    createReview: (_prNumber: number, _submission: ReviewSubmission) =>
      Promise.resolve(ok('')),
    replyToComment: () => Promise.resolve(ok('')),
    getHeadSha: () => Promise.resolve(ok('headsha')),
    createFileComment: () => Promise.resolve(ok('')),
    createConversationComment: () => Promise.resolve(ok('')),
    listReviewComments: () => Promise.resolve(ok([])),
    listConversationComments: () => Promise.resolve(ok([])),
    listReviewThreads: () => Promise.resolve(ok([])),
    resolveReviewThread: () => Promise.resolve(ok('')),
    unresolveReviewThread: () => Promise.resolve(ok('')),
    listChecks: () => Promise.resolve(ok({ state: 'success', checks: [] })),
    listCommits: () => Promise.resolve(ok([])),
  };
  return { client, contentCalls };
}

describe('workingDirKey', () => {
  it('joins owner, repo and number with dashes', () => {
    expect(workingDirKey(baseMeta)).toBe('acme-shop-7');
  });
});

describe('fetchPr', () => {
  it('assembles RawPr and fetches content for non-deleted files only', async () => {
    const { client, contentCalls } = fakeGhClient({
      files: ok([
        { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@' },
        { path: 'src/gone.ts', status: 'deleted', additions: 0, deletions: 9 },
      ]),
      diff: ok('full diff'),
    });

    const result = await fetchPr(client, '7');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.meta).toEqual(baseMeta);
      expect(result.value.diff).toBe('full diff');
      expect(result.value.files[0].content).toBe('content:src/a.ts');
      expect(result.value.files[1].content).toBeUndefined();
    }
    expect(contentCalls).toEqual([{ path: 'src/a.ts', ref: 'abc123sha' }]);
  });

  it('tolerates a per-file content failure without failing the whole fetch', async () => {
    const { client } = fakeGhClient({
      files: ok([
        { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 },
      ]),
      contentByPath: { 'src/a.ts': err({ message: 'binary' }) },
    });

    const result = await fetchPr(client, '7');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.files[0].content).toBeUndefined();
    }
  });

  it('fails fast when listing changed files fails', async () => {
    const { client } = fakeGhClient({ files: err({ message: 'no access' }) });

    const result = await fetchPr(client, '7');

    expect(isOk(result)).toBe(false);
  });
});
