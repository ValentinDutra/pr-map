import { describe, it, expect } from 'vitest';
import { statusForAskError } from './ai-endpoints.js';

describe('statusForAskError', () => {
  it('maps llama_not_found to 503', () => {
    expect(statusForAskError('llama_not_found')).toBe(503);
  });

  it('maps model_load_failed to 502', () => {
    expect(statusForAskError('model_load_failed')).toBe(502);
  });

  it('maps request_failed to 502', () => {
    expect(statusForAskError('request_failed')).toBe(502);
  });
});
