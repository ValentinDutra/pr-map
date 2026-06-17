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
