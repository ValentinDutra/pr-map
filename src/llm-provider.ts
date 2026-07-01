import { type Result, ok, err, isOk } from './result.js';
import { retry, type RetryOptions } from './retry.js';
import type { ChatMessage } from './types.js';

export type LlmErrorCode = 'llama_not_found' | 'model_load_failed' | 'request_failed';

export interface LlmError {
  code: LlmErrorCode;
  message: string;
}

// A minimal completion interface so the enricher (and its tests) depend on an abstraction, not
// a concrete HTTP client. `chat` is the primitive (multi-turn); `complete` delegates to it.
export interface LlmProvider {
  chat(messages: ChatMessage[]): Promise<Result<string, LlmError>>;
  complete(prompt: string): Promise<Result<string, LlmError>>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY: RetryOptions = { attempts: 3, delayMs: 500 };
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder';
// 127.0.0.1, not localhost: Node's fetch resolves `localhost` to IPv6 (::1) first, which fails
// against an IPv4-only Ollama (the common default) with an instant ECONNREFUSED.
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// POST JSON with an AbortController timeout, returning a Result instead of throwing, so callers
// stay in the Result/Retry world. A non-2xx response and a network/timeout error both map to err.
async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Result<unknown, LlmError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return err({ code: 'request_failed', message: `${url} returned ${response.status}: ${text.slice(0, 200)}` });
    }
    return ok((await response.json()) as unknown);
  } catch (error) {
    const reason =
      (error as Error).name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : (error as Error).message;
    return err({ code: 'request_failed', message: `request to ${url} failed: ${reason}` });
  } finally {
    clearTimeout(timer);
  }
}

export interface OllamaOptions {
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  retryOptions?: RetryOptions;
}

// Local Ollama via its native chat API (POST /api/chat, non-streaming).
export function createOllamaProvider(options: OllamaOptions): LlmProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions = options.retryOptions ?? DEFAULT_RETRY;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/api/chat`;
  return {
    chat(messages) {
      return retry(async () => {
        const response = await postJson(
          url,
          { model: options.model, stream: false, messages },
          {},
          timeoutMs,
        );
        if (!isOk(response)) return response;
        const content = (response.value as { message?: { content?: string } }).message?.content;
        if (typeof content !== 'string') {
          return err({ code: 'request_failed', message: 'Ollama response had no message.content' });
        }
        return ok(content);
      }, retryOptions);
    },
    complete(prompt) {
      return this.chat([{ role: 'user', content: prompt }]);
    },
  };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retryOptions?: RetryOptions;
}

// Any OpenAI-compatible chat endpoint (OpenAI, Groq, Together, OpenRouter, a remote Ollama /v1).
// baseUrl is expected to include the version path, e.g. https://api.openai.com/v1.
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions = options.retryOptions ?? DEFAULT_RETRY;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    chat(messages) {
      return retry(async () => {
        const response = await postJson(
          url,
          { model: options.model, messages },
          { Authorization: `Bearer ${options.apiKey}` },
          timeoutMs,
        );
        if (!isOk(response)) return response;
        const content = (
          response.value as { choices?: { message?: { content?: string } }[] }
        ).choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          return err({ code: 'request_failed', message: 'OpenAI-compatible response had no choices[0].message.content' });
        }
        return ok(content);
      }, retryOptions);
    },
    complete(prompt) {
      return this.chat([{ role: 'user', content: prompt }]);
    },
  };
}

// The subset of process.env the provider switch reads. Passed in (not read globally) so it is
// trivially testable.
export interface ProviderEnv {
  PRMAP_LLM_PROVIDER?: string;
  PRMAP_LLM_MODEL?: string;
  PRMAP_LLM_BASE_URL?: string;
  PRMAP_LLM_API_KEY?: string;
  PRMAP_LLM_TIMEOUT_MS?: string;
}

// Build the configured provider from environment variables, validating up front so a
// misconfiguration fails with a clear message instead of a cryptic fetch error mid-run.
export function selectProvider(env: ProviderEnv): Result<LlmProvider, LlmError> {
  const provider = (env.PRMAP_LLM_PROVIDER ?? 'ollama').toLowerCase();
  const parsedTimeout = env.PRMAP_LLM_TIMEOUT_MS
    ? Number.parseInt(env.PRMAP_LLM_TIMEOUT_MS, 10)
    : undefined;
  const timeoutMs =
    parsedTimeout !== undefined && Number.isFinite(parsedTimeout) ? parsedTimeout : undefined;

  if (provider === 'ollama') {
    return ok(
      createOllamaProvider({
        model: env.PRMAP_LLM_MODEL ?? DEFAULT_OLLAMA_MODEL,
        baseUrl: env.PRMAP_LLM_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
        timeoutMs,
      }),
    );
  }

  if (provider === 'openai-compatible') {
    if (!env.PRMAP_LLM_BASE_URL) {
      return err({
        code: 'request_failed',
        message:
          'PRMAP_LLM_BASE_URL is required for the openai-compatible provider (e.g. https://api.openai.com/v1).',
      });
    }
    if (!env.PRMAP_LLM_API_KEY) {
      return err({ code: 'request_failed', message: 'PRMAP_LLM_API_KEY is required for the openai-compatible provider.' });
    }
    if (!env.PRMAP_LLM_MODEL) {
      return err({
        code: 'request_failed',
        message: 'PRMAP_LLM_MODEL is required for the openai-compatible provider (e.g. gpt-4o-mini).',
      });
    }
    return ok(
      createOpenAiCompatibleProvider({
        baseUrl: env.PRMAP_LLM_BASE_URL,
        apiKey: env.PRMAP_LLM_API_KEY,
        model: env.PRMAP_LLM_MODEL,
        timeoutMs,
      }),
    );
  }

  return err({
    code: 'request_failed',
    message: `Unknown PRMAP_LLM_PROVIDER "${provider}". Use "ollama" or "openai-compatible".`,
  });
}
