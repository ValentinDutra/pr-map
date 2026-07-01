# #55 — Deepen llm-provider to a `chat()` primitive + shared chat vocabulary

## Goal
Make a multi-turn conversation the primitive of the LLM provider abstraction, without changing
any existing behavior. Today `LlmProvider` only exposes `complete(prompt: string)`. We add
`chat(messages: ChatMessage[])` as the real primitive and make `complete` a thin delegate, so the
upcoming local-model chat feature (#57 `POST /api/ai/ask`) can hold a conversation while
enrichment keeps calling `complete` byte-for-byte identically. We also add the shared vocabulary
(`ChatMessage`, `ModelInfo`) and a discriminating `code` on `LlmError` that later slices (the
popup's "install llama.cpp" vs "request failed" states) depend on. This is the enabling
groundwork slice for #56/#57/#59/#60/#61/#62.

## Approach
A **deepening, not a widening**: both existing adapters already POST a `messages` array
internally, so `chat(messages)` is a trivial extraction and `complete(prompt)` shrinks to
`chat([{ role: 'user', content: prompt }])`. The single-message request body stays identical to
today's, guaranteeing enrichment output is unchanged. Grounded in the existing code in
`src/llm-provider.ts` (`createOllamaProvider`, `createOpenAiCompatibleProvider`) and the
Result/Retry helpers in `src/result.ts` / `src/retry.ts`.

## Constraints
- Do NOT implement the `LocalChat` runner, any `/api/ai/*` endpoint, or `llama-server` process
  spawning — those are issues #56 and #57.
- Do NOT change the observable behavior of `complete()`: the single-message request body and the
  returned text must stay byte-identical (the existing `enrich`/provider tests must still pass).
- Do NOT add any code that *produces* `'llama_not_found'` or `'model_load_failed'` yet — this
  issue only introduces the `code` type union and uses `'request_failed'` at existing error
  sites. The other two codes arrive with the runner in #57.
- Do NOT cross the src↔dashboard package boundary: `dashboard/src/types.ts` is a hand-maintained
  mirror (see its header comment) — duplicate the type declarations, do not import across.
- Stay in the Result world: no throwing; errors are `err(...)` values.

## Patterns to follow
- Provider structure, Result/Retry usage, `postJson` timeout handling: follow the existing
  `createOllamaProvider` and `createOpenAiCompatibleProvider` in `src/llm-provider.ts`.
- Result helpers (`ok`, `err`, `isOk`): `src/result.ts`.
- Tests: follow the `describe('selectProvider', ...)` structure in `src/llm-provider.test.ts`.
  For HTTP mocking, use vitest's `vi.stubGlobal('fetch', vi.fn(...))` with
  `afterEach(() => vi.unstubAllGlobals())`.
- Type-mirror convention: `dashboard/src/types.ts` header comment ("Mirrors the PrGraph contract
  from ../../src/types.ts. Kept as a separate copy ...").

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check: `npm run typecheck && npm --prefix dashboard run build`

## Current state
- `src/llm-provider.ts` defines `interface LlmError { message: string }`, `interface LlmProvider
  { complete(prompt): Promise<Result<string, LlmError>> }`, and two factories
  (`createOllamaProvider` → POST `/api/chat` `{ model, stream:false, messages:[{role:'user',
  content:prompt}] }`; `createOpenAiCompatibleProvider` → POST `/chat/completions` `{ model,
  messages:[{role:'user',content:prompt}] }` with a Bearer header). Both extract text and wrap in
  `retry(...)`. There are **8** `err({ message })` sites (lines ~40, 48, 78, 114, 154, 160, 163,
  177). `selectProvider(env)` builds a provider from env.
- `src/llm-provider.test.ts` only tests `selectProvider` (no fetch mocking yet).
- `src/enrich.test.ts` imports `LlmError` and builds error Results via a `fixedProvider` helper.
- `src/types.ts` and `dashboard/src/types.ts` hold the graph contract; neither has any LLM/chat
  types yet.

## Desired end state
- `LlmProvider` exposes both `chat(messages: ChatMessage[]): Promise<Result<string, LlmError>>`
  (primitive) and `complete(prompt: string): Promise<Result<string, LlmError>>` (delegates to
  `chat([{ role:'user', content: prompt }])`). Both adapters implement `chat` by POSTing the full
  `messages` array.
- `LlmError` is `{ code: LlmErrorCode; message: string }` with
  `type LlmErrorCode = 'llama_not_found' | 'model_load_failed' | 'request_failed'`; every existing
  error site sets `code: 'request_failed'`.
- `ChatMessage` and `ModelInfo` exist, identical, in both `src/types.ts` and
  `dashboard/src/types.ts`.
- All three verification commands pass; existing enrichment behavior is unchanged.

## Edge cases and risks
- Making `code` required on `LlmError` is a breaking type change — every construction site must
  set it. `tsc` catches misses; watch `src/enrich.test.ts` for inline `err({ message })` that now
  needs a `code`.
- `complete` delegation must preserve the exact single-message request body so enrichment output
  is byte-identical — the delegate produces `messages:[{role:'user',content:prompt}]`, matching
  today.
- Fetch mocking must not leak between tests — always `vi.unstubAllGlobals()` in `afterEach`.
- Keep the openai-compatible `Authorization: Bearer` header inside the new `chat` path.

## Tasks

- [x] Add the shared chat vocabulary types. In `src/types.ts`, append two exported interfaces (near the other exported interfaces): `export interface ChatMessage { role: 'user' | 'assistant'; content: string }` and `export interface ModelInfo { id: string; name: string; path: string }`. Then add the IDENTICAL two interfaces to `dashboard/src/types.ts` (the hand-maintained mirror described in its header comment) — same names, fields, and order; duplicate the declarations, do not import across the package boundary. Pure type declarations need no unit test; verify they compile with `npm run typecheck && npm --prefix dashboard run build`.
- [x] Add a discriminating `code` to `LlmError`. In `src/llm-provider.ts`, add `export type LlmErrorCode = 'llama_not_found' | 'model_load_failed' | 'request_failed'` and change `interface LlmError` to `{ code: LlmErrorCode; message: string }`. Update all 8 existing `err({ ... })` sites in this file (the two in `postJson`, the ollama `message.content` guard, the openai `choices[0].message.content` guard, and the four in `selectProvider`) to include `code: 'request_failed'` (the other two codes are not produced until #57). If `src/enrich.test.ts` builds any inline `err({ message })` of type `LlmError`, add `code: 'request_failed'` there too so it type-checks. Add a test in `src/llm-provider.test.ts` (extend the existing `selectProvider` describe or add a sibling): assert `selectProvider({ PRMAP_LLM_PROVIDER: 'banana' })` returns an error whose `.error.code === 'request_failed'` (alongside the existing message assertion). Run `npm test`.
- [x] Now that `ChatMessage` (task 1) and `LlmError.code` (task 2) exist, deepen the provider to a `chat()` primitive. In `src/llm-provider.ts`, import `ChatMessage` from `./types.js`; add `chat(messages: ChatMessage[]): Promise<Result<string, LlmError>>` to the `LlmProvider` interface (keep `complete`). Refactor `createOllamaProvider` so `chat(messages)` POSTs `{ model, stream: false, messages }` (forward the array as-is) reusing the same `retry`/`postJson`/timeout and `message.content` extraction, and implement `complete(prompt)` as `chat([{ role: 'user', content: prompt }])`. Do the same for `createOpenAiCompatibleProvider`: `chat(messages)` POSTs `{ model, messages }` keeping the `Authorization: Bearer` header and the `choices[0].message.content` extraction; `complete(prompt)` delegates identically. Add tests in `src/llm-provider.test.ts` using `vi.stubGlobal('fetch', vi.fn(...))` (with `afterEach(() => vi.unstubAllGlobals())`): (a) `createOllamaProvider(...).chat([{role:'user',content:'a'},{role:'assistant',content:'b'},{role:'user',content:'c'}])` posts a body whose `messages` equals those three verbatim and returns the mocked `message.content`; (b) `createOpenAiCompatibleProvider(...).chat([...])` forwards `messages` verbatim in the posted body and returns `choices[0].message.content`; (c) `complete('hi')` on the ollama provider posts exactly one message `{role:'user',content:'hi'}` (proves delegation). Run `npm test`.
- [x] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm run typecheck && npm --prefix dashboard run build`.
