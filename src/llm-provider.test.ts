import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectProvider, createOllamaProvider, createOpenAiCompatibleProvider } from './llm-provider.js';
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

  it('returns an error with code request_failed for unknown provider', () => {
    const result = selectProvider({ PRMAP_LLM_PROVIDER: 'banana' });
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe('request_failed');
  });

  it('honors a numeric PRMAP_LLM_TIMEOUT_MS by aborting the request at that timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );

    try {
      const selected = selectProvider({ PRMAP_LLM_TIMEOUT_MS: '5' });
      expect(isOk(selected)).toBe(true);
      if (!isOk(selected)) return;

      const result = await selected.value.chat([{ role: 'user', content: 'hi' }]);

      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error.code).toBe('request_failed');
        expect(result.error.message).toContain('timed out after 5ms');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createOllamaProvider chat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the messages array verbatim and returns the message content', async () => {
    const messages = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
      { role: 'user' as const, content: 'c' },
    ];
    let postedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        postedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ message: { content: 'reply' } }), { status: 200 });
      }),
    );

    const provider = createOllamaProvider({ model: 'test-model', baseUrl: 'http://localhost:11434' });
    const result = await provider.chat(messages);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('reply');
    expect((postedBody as { messages: unknown }).messages).toEqual(messages);
  });

  it('complete delegates to chat with a single user message', async () => {
    let postedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        postedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ message: { content: 'done' } }), { status: 200 });
      }),
    );

    const provider = createOllamaProvider({ model: 'test-model', baseUrl: 'http://localhost:11434' });
    const result = await provider.complete('hi');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('done');
    expect((postedBody as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('createOpenAiCompatibleProvider chat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the messages array verbatim with bearer header and returns choices content', async () => {
    const messages = [
      { role: 'user' as const, content: 'x' },
      { role: 'assistant' as const, content: 'y' },
      { role: 'user' as const, content: 'z' },
    ];
    let postedBody: unknown;
    let capturedHeaders: Record<string, string> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        postedBody = JSON.parse(init.body as string);
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), { status: 200 });
      }),
    );

    const provider = createOpenAiCompatibleProvider({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const result = await provider.chat(messages);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('answer');
    expect((postedBody as { messages: unknown }).messages).toEqual(messages);
    expect((capturedHeaders as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('returns request_failed with the http status in the message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('service unavailable', { status: 503 })),
    );

    const provider = createOpenAiCompatibleProvider({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      retryOptions: { attempts: 1, delayMs: 0 },
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('request_failed');
      expect(result.error.message).toContain('503');
    }
  });

  it('returns request_failed when choices[0].message.content is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })),
    );

    const provider = createOpenAiCompatibleProvider({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      retryOptions: { attempts: 1, delayMs: 0 },
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe('request_failed');
  });

  it('maps a network failure to request_failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const provider = createOpenAiCompatibleProvider({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      retryOptions: { attempts: 1, delayMs: 0 },
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe('request_failed');
  });

  it('complete delegates to chat with a single user message', async () => {
    let postedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        postedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 });
      }),
    );

    const provider = createOpenAiCompatibleProvider({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const result = await provider.complete('hi');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('done');
    expect((postedBody as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
