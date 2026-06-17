import { type Result, isOk } from './result.js';

export interface RetryOptions {
  attempts: number;
  delayMs: number;
}

export async function retry<T, E>(
  operation: () => Promise<Result<T, E>>,
  options: RetryOptions,
): Promise<Result<T, E>> {
  const totalAttempts = Math.max(1, options.attempts);
  let lastResult = await operation();
  let attemptsMade = 1;
  while (!isOk(lastResult) && attemptsMade < totalAttempts) {
    if (options.delayMs > 0) {
      await delay(options.delayMs);
    }
    lastResult = await operation();
    attemptsMade += 1;
  }
  return lastResult;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
