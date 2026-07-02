import { describe, it, expect } from 'vitest';
import {
  COLD_MS,
  COLD_SLOW_MS,
  COLD_COPY,
  COLD_SLOW_COPY,
  classifyAskError,
  thinkingPhase,
} from './ask-status';

describe('classifyAskError', () => {
  it('returns unavailable for llama_not_found code', () => {
    expect(classifyAskError({ code: 'llama_not_found' })).toBe('unavailable');
  });

  it('returns failed for request_failed code', () => {
    expect(classifyAskError({ code: 'request_failed' })).toBe('failed');
  });

  it('returns failed for model_load_failed code', () => {
    expect(classifyAskError({ code: 'model_load_failed' })).toBe('failed');
  });

  it('returns failed for object with no code', () => {
    expect(classifyAskError({})).toBe('failed');
  });

  it('returns failed for plain Error', () => {
    expect(classifyAskError(new Error('x'))).toBe('failed');
  });
});

describe('thinkingPhase', () => {
  it('returns warm for 0ms', () => {
    expect(thinkingPhase(0)).toBe('warm');
  });

  it('returns warm just below COLD_MS', () => {
    expect(thinkingPhase(COLD_MS - 1)).toBe('warm');
  });

  it('returns cold at COLD_MS', () => {
    expect(thinkingPhase(COLD_MS)).toBe('cold');
  });

  it('returns cold just below COLD_SLOW_MS', () => {
    expect(thinkingPhase(COLD_SLOW_MS - 1)).toBe('cold');
  });

  it('returns cold-slow at COLD_SLOW_MS', () => {
    expect(thinkingPhase(COLD_SLOW_MS)).toBe('cold-slow');
  });
});

describe('constants', () => {
  it('exports COLD_MS as 1600', () => {
    expect(COLD_MS).toBe(1600);
  });

  it('exports COLD_SLOW_MS as 6600', () => {
    expect(COLD_SLOW_MS).toBe(6600);
  });

  it('exports COLD_COPY', () => {
    expect(COLD_COPY).toBe('Starting local model…');
  });

  it('exports COLD_SLOW_COPY', () => {
    expect(COLD_SLOW_COPY).toBe('Still warming up — the first run is slow.');
  });
});
