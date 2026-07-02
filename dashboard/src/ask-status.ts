export const COLD_MS = 1600;
export const COLD_SLOW_MS = 6600;

export const COLD_COPY = 'Starting local model…';
export const COLD_SLOW_COPY = 'Still warming up — the first run is slow.';

export function classifyAskError(err: unknown): 'unavailable' | 'failed' {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'llama_not_found'
  ) {
    return 'unavailable';
  }
  return 'failed';
}

export function thinkingPhase(elapsedMs: number): 'warm' | 'cold' | 'cold-slow' {
  if (elapsedMs < COLD_MS) {
    return 'warm';
  }
  if (elapsedMs < COLD_SLOW_MS) {
    return 'cold';
  }
  return 'cold-slow';
}
