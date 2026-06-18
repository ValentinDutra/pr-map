import { describe, it, expect } from 'vitest';
import { createGhClient, type CommandExecutor, type GhError } from './gh-client.js';
import { ok, err, isOk, type Result } from './result.js';

interface RecordedCall {
  args: string[];
  stdin?: string;
}

function recordingExecutor(responses: Result<string, GhError>[]): {
  execute: CommandExecutor;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const execute: CommandExecutor = (args, stdin) => {
    calls.push({ args, stdin });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response);
  };
  return { execute, calls };
}

const noDelayRetry = { attempts: 3, delayMs: 0 };

describe('createGhClient', () => {
  it('getPrMetadata builds the right gh args and parses owner/repo from the url', async () => {
    const { execute, calls } = recordingExecutor([
      ok(
        JSON.stringify({
          number: 42,
          title: 'Add discount calculator',
          body: 'Implements discounts',
          author: { login: 'octocat' },
          baseRefName: 'main',
          headRefName: 'feature/discount',
          url: 'https://github.com/acme/shop/pull/42',
        }),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.getPrMetadata('42');

    expect(calls[0].args).toEqual([
      'pr',
      'view',
      '42',
      '--json',
      'number,title,body,author,baseRefName,headRefName,url',
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.owner).toBe('acme');
      expect(result.value.repo).toBe('shop');
      expect(result.value.number).toBe(42);
      expect(result.value.author).toBe('octocat');
      expect(result.value.baseRef).toBe('main');
    }
  });

  it('listChangedFiles maps the GitHub "removed" status to "deleted"', async () => {
    const { execute } = recordingExecutor([
      ok(
        JSON.stringify([
          { filename: 'a.ts', status: 'removed', additions: 0, deletions: 9 },
          { filename: 'b.ts', status: 'added', additions: 5, deletions: 0 },
        ]),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChangedFiles(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toMatchObject({ path: 'a.ts', status: 'deleted' });
      expect(result.value[1]).toMatchObject({ path: 'b.ts', status: 'added' });
    }
  });

  it('createReview targets the reviews endpoint and sends the submission as JSON stdin', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.createReview(42, {
      event: 'COMMENT',
      body: 'Looks good',
      comments: [{ path: 'a.ts', line: 10, side: 'RIGHT', body: 'nit' }],
    });

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/pulls/42/reviews',
      '--method',
      'POST',
      '--input',
      '-',
    ]);
    expect(JSON.parse(calls[0].stdin ?? '')).toEqual({
      event: 'COMMENT',
      body: 'Looks good',
      comments: [{ path: 'a.ts', line: 10, side: 'RIGHT', body: 'nit' }],
    });
  });

  it('getFileContent percent-encodes path segments and the ref', async () => {
    const { execute, calls } = recordingExecutor([ok('file body')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.getFileContent('src/my file.ts', 'feature/x');

    expect(calls[0].args[0]).toBe('api');
    expect(calls[0].args[1]).toBe(
      'repos/{owner}/{repo}/contents/src/my%20file.ts?ref=feature%2Fx',
    );
  });

  it('retries a transient failure before succeeding', async () => {
    const { execute, calls } = recordingExecutor([
      err({ message: 'transient' }),
      ok('diff output'),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.getDiff('42');

    expect(calls).toHaveLength(2);
    expect(isOk(result)).toBe(true);
  });

  it('createReview maps a multi-line range comment to start_line/start_side', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.createReview(42, {
      event: 'COMMENT',
      body: '',
      comments: [
        { path: 'a.ts', line: 20, side: 'RIGHT', startLine: 18, startSide: 'RIGHT', body: 'range nit' },
      ],
    });

    expect(JSON.parse(calls[0].stdin ?? '').comments[0]).toEqual({
      path: 'a.ts',
      body: 'range nit',
      line: 20,
      side: 'RIGHT',
      start_line: 18,
      start_side: 'RIGHT',
    });
  });

  it('createFileComment targets the comments endpoint with subject_type file and commit_id', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.createFileComment(42, 'abc123', 'src/a.ts', 'whole-file note');

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/pulls/42/comments',
      '--method',
      'POST',
      '--input',
      '-',
    ]);
    expect(JSON.parse(calls[0].stdin ?? '')).toEqual({
      commit_id: 'abc123',
      path: 'src/a.ts',
      subject_type: 'file',
      body: 'whole-file note',
    });
  });

  it('createConversationComment posts to the issues comments endpoint', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.createConversationComment(42, 'general thought');

    expect(calls[0].args[1]).toBe('repos/{owner}/{repo}/issues/42/comments');
    expect(JSON.parse(calls[0].stdin ?? '')).toEqual({ body: 'general thought' });
  });

  it('listReviewComments paginates the pulls comments endpoint and normalizes each comment', async () => {
    const { execute, calls } = recordingExecutor([
      ok(
        JSON.stringify([
          {
            id: 1,
            path: 'a.ts',
            line: 12,
            original_line: 10,
            side: 'RIGHT',
            body: 'inline note',
            user: { login: 'octocat' },
            created_at: '2026-06-01T00:00:00Z',
            in_reply_to_id: 7,
          },
          {
            id: 2,
            path: 'b.ts',
            line: null,
            original_line: 4,
            side: 'LEFT',
            body: 'outdated note',
            user: null,
            created_at: '2026-06-02T00:00:00Z',
          },
        ]),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listReviewComments(42);

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/pulls/42/comments',
      '--paginate',
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toEqual({
        id: 1,
        path: 'a.ts',
        line: 12,
        side: 'RIGHT',
        body: 'inline note',
        author: 'octocat',
        createdAt: '2026-06-01T00:00:00Z',
        inReplyToId: 7,
      });
      // Falls back to original_line when line is null, defaults author and reply id.
      expect(result.value[1]).toMatchObject({ line: 4, author: '', inReplyToId: null });
    }
  });

  it('listConversationComments reads the issues comments endpoint', async () => {
    const { execute, calls } = recordingExecutor([
      ok(
        JSON.stringify([
          {
            id: 9,
            body: 'general thought',
            user: { login: 'reviewer' },
            created_at: '2026-06-03T00:00:00Z',
          },
        ]),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listConversationComments(42);

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/issues/42/comments',
      '--paginate',
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toEqual({
        id: 9,
        body: 'general thought',
        author: 'reviewer',
        createdAt: '2026-06-03T00:00:00Z',
      });
    }
  });

  it('listChecks resolves the head sha then queries check-runs and combined status, merging both', async () => {
    const { execute, calls } = recordingExecutor([
      ok('feedface\n'),
      ok(
        JSON.stringify({
          check_runs: [
            {
              name: 'unit-tests',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/acme/shop/runs/1',
            },
          ],
        }),
      ),
      ok(
        JSON.stringify({
          state: 'success',
          statuses: [
            { context: 'ci/legacy', state: 'success', target_url: 'https://ci.example/1' },
          ],
        }),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChecks(42);

    expect(calls[0].args).toEqual(['api', 'repos/{owner}/{repo}/pulls/42', '--jq', '.head.sha']);
    expect(calls[1].args).toEqual([
      'api',
      'repos/{owner}/{repo}/commits/feedface/check-runs',
      '--paginate',
    ]);
    expect(calls[2].args).toEqual(['api', 'repos/{owner}/{repo}/commits/feedface/status']);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.state).toBe('success');
      expect(result.value.checks).toEqual([
        {
          name: 'unit-tests',
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/acme/shop/runs/1',
        },
        {
          name: 'ci/legacy',
          status: 'completed',
          conclusion: 'success',
          url: 'https://ci.example/1',
        },
      ]);
    }
  });

  it('listChecks reports pending when any check-run is still in progress', async () => {
    const { execute } = recordingExecutor([
      ok('sha\n'),
      ok(
        JSON.stringify({
          check_runs: [{ name: 'build', status: 'in_progress', conclusion: null, html_url: null }],
        }),
      ),
      ok(JSON.stringify({ state: 'success', statuses: [] })),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChecks(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.state).toBe('pending');
  });

  it('listChecks reports failure when a settled check-run failed and none are pending', async () => {
    const { execute } = recordingExecutor([
      ok('sha\n'),
      ok(
        JSON.stringify({
          check_runs: [
            { name: 'lint', status: 'completed', conclusion: 'success', html_url: null },
            { name: 'e2e', status: 'completed', conclusion: 'timed_out', html_url: null },
          ],
        }),
      ),
      ok(JSON.stringify({ state: 'success', statuses: [] })),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChecks(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.state).toBe('failure');
  });

  it('listChecks reports failure from the legacy combined status even with no check-runs', async () => {
    const { execute } = recordingExecutor([
      ok('sha\n'),
      ok(JSON.stringify({ check_runs: [] })),
      ok(
        JSON.stringify({
          state: 'failure',
          statuses: [{ context: 'ci/legacy', state: 'failure', target_url: null }],
        }),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChecks(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.state).toBe('failure');
      expect(result.value.checks).toEqual([
        { name: 'ci/legacy', status: 'completed', conclusion: 'failure', url: null },
      ]);
    }
  });

  it('listChecks propagates a head-sha failure without querying checks', async () => {
    const { execute, calls } = recordingExecutor([err({ message: 'no access' })]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listChecks(42);

    // Three retry attempts on the failing head-sha call, then it gives up before any checks call.
    expect(calls).toHaveLength(3);
    expect(isOk(result)).toBe(false);
  });

  it('listCommits paginates the pulls commits endpoint and normalizes each commit', async () => {
    const { execute, calls } = recordingExecutor([
      ok(
        JSON.stringify([
          {
            sha: 'abc1234567890',
            html_url: 'https://github.com/acme/shop/commit/abc1234567890',
            commit: {
              message: 'Add discounts\n\nLonger body explaining the change.',
              author: { name: 'Ada Lovelace', date: '2026-06-01T00:00:00Z' },
            },
            author: { login: 'ada' },
          },
          {
            sha: 'def4567890123',
            html_url: 'https://github.com/acme/shop/commit/def4567890123',
            commit: { message: 'Fix typo', author: null },
            author: { login: 'octocat' },
          },
        ]),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listCommits(42);

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/pulls/42/commits',
      '--paginate',
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toEqual({
        sha: 'abc1234567890',
        shortSha: 'abc1234',
        // Only the subject line of the message is kept.
        message: 'Add discounts',
        author: 'Ada Lovelace',
        date: '2026-06-01T00:00:00Z',
        url: 'https://github.com/acme/shop/commit/abc1234567890',
      });
      // Falls back to the GitHub login and an empty date when commit.author is null.
      expect(result.value[1]).toMatchObject({ author: 'octocat', date: '' });
    }
  });

  it('listReviewThreads passes owner/name/number placeholders and normalizes each thread', async () => {
    const { execute, calls } = recordingExecutor([
      ok(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: 'PRRT_resolved',
                      isResolved: true,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 11,
                            body: 'first',
                            createdAt: '2026-06-01T00:00:00Z',
                            path: 'a.ts',
                            line: 12,
                            originalLine: 9,
                            author: { login: 'octocat' },
                          },
                          {
                            databaseId: 12,
                            body: 'reply',
                            createdAt: '2026-06-01T01:00:00Z',
                            path: 'a.ts',
                            line: 12,
                            originalLine: 9,
                            author: null,
                          },
                        ],
                      },
                    },
                    {
                      id: 'PRRT_outdated',
                      isResolved: false,
                      isOutdated: true,
                      comments: {
                        nodes: [
                          {
                            databaseId: 20,
                            body: 'outdated note',
                            createdAt: '2026-06-02T00:00:00Z',
                            path: 'b.ts',
                            line: null,
                            originalLine: 4,
                            author: { login: 'reviewer' },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      ),
    ]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.listReviewThreads(42);

    expect(calls[0].args).toEqual([
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-F',
      'number=42',
      '-f',
      expect.stringContaining('reviewThreads(first: 100)'),
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toEqual({
        id: 'PRRT_resolved',
        isResolved: true,
        path: 'a.ts',
        line: 12,
        comments: [
          { id: 11, author: 'octocat', body: 'first', createdAt: '2026-06-01T00:00:00Z' },
          // The reply defaults a missing author to an empty string.
          { id: 12, author: '', body: 'reply', createdAt: '2026-06-01T01:00:00Z' },
        ],
      });
      // Falls back to the first comment's originalLine when its current line is null.
      expect(result.value[1]).toMatchObject({ id: 'PRRT_outdated', isResolved: false, line: 4 });
    }
  });

  it('resolveReviewThread sends the resolve mutation with the thread id variable', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.resolveReviewThread('PRRT_abc');

    expect(calls[0].args).toEqual([
      'api',
      'graphql',
      '-F',
      'threadId=PRRT_abc',
      '-f',
      expect.stringContaining('resolveReviewThread'),
    ]);
  });

  it('unresolveReviewThread sends the unresolve mutation with the thread id variable', async () => {
    const { execute, calls } = recordingExecutor([ok('')]);
    const client = createGhClient(execute, noDelayRetry);

    await client.unresolveReviewThread('PRRT_xyz');

    expect(calls[0].args).toEqual([
      'api',
      'graphql',
      '-F',
      'threadId=PRRT_xyz',
      '-f',
      expect.stringContaining('unresolveReviewThread'),
    ]);
  });

  it('getHeadSha returns the trimmed head sha', async () => {
    const { execute, calls } = recordingExecutor([ok('deadbeef\n')]);
    const client = createGhClient(execute, noDelayRetry);

    const result = await client.getHeadSha(42);

    expect(calls[0].args).toEqual([
      'api',
      'repos/{owner}/{repo}/pulls/42',
      '--jq',
      '.head.sha',
    ]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('deadbeef');
  });
});
