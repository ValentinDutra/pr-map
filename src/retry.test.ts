import { describe, it, expect } from 'vitest';
import { retry } from './retry.js';
import { ok, err, isOk, type Result } from './result.js';

describe('retry', () => {
  it('succeeds within the attempt budget when the operation eventually returns ok', async () => {
    let calls = 0;
    const operation = async (): Promise<Result<string, string>> => {
      calls += 1;
      return calls < 3 ? err('transient') : ok('done');
    };

    const result = await retry(operation, { attempts: 3, delayMs: 0 });

    expect(isOk(result)).toBe(true);
    expect(calls).toBe(3);
  });

  it('returns err after exactly `attempts` calls when the operation always fails', async () => {
    let calls = 0;
    const operation = async (): Promise<Result<string, string>> => {
      calls += 1;
      return err('always');
    };

    const result = await retry(operation, { attempts: 3, delayMs: 0 });

    expect(isOk(result)).toBe(false);
    expect(calls).toBe(3);
  });
});
