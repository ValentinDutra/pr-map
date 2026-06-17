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
});
