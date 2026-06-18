import { describe, it, expect } from 'vitest';
import { selectProvider } from './llm-provider.js';
import { isOk } from './result.js';

describe('selectProvider', () => {
  it('defaults to an ollama provider when nothing is configured', () => {
    expect(isOk(selectProvider({}))).toBe(true);
  });

  it('requires base url, key, and model for the openai-compatible provider', () => {
    expect(isOk(selectProvider({ PRMAP_LLM_PROVIDER: 'openai-compatible' }))).toBe(false);
    expect(
      isOk(selectProvider({ PRMAP_LLM_PROVIDER: 'openai-compatible', PRMAP_LLM_BASE_URL: 'https://x/v1' })),
    ).toBe(false);
    expect(
      isOk(
        selectProvider({
          PRMAP_LLM_PROVIDER: 'openai-compatible',
          PRMAP_LLM_BASE_URL: 'https://x/v1',
          PRMAP_LLM_API_KEY: 'k',
        }),
      ),
    ).toBe(false);
    expect(
      isOk(
        selectProvider({
          PRMAP_LLM_PROVIDER: 'openai-compatible',
          PRMAP_LLM_BASE_URL: 'https://x/v1',
          PRMAP_LLM_API_KEY: 'k',
          PRMAP_LLM_MODEL: 'gpt-4o-mini',
        }),
      ),
    ).toBe(true);
  });

  it('rejects an unknown provider with a clear message', () => {
    const result = selectProvider({ PRMAP_LLM_PROVIDER: 'banana' });
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.message).toContain('banana');
  });
});
