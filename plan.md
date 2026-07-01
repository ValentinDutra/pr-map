# #57 — POST /api/ai/ask runs a local model end-to-end (spawn / swap / serialized)

## Goal
Make the reviewer able to actually ask a local model about code. Widen `LocalChat` with `ask`
and `shutdown`: `ask({ model, messages })` idempotently ensures the right `llama-server` child
is running for the chosen model, then proxies an OpenAI-compatible chat and returns the reply.
Expose it as `POST /api/ai/ask`, mapping a missing `llama-server` to HTTP 503 so the eventual
popup can say "install llama.cpp". Depends on #56's `LocalChat`/`listModels` and #55's `chat()`
provider. This is the core of the whole feature.

## Approach
A deep `LocalChat` hides the entire process lifecycle behind `ask`. The messy parts sit behind
two INJECTED seams so the orchestration is unit-testable without a real binary or network:
- `spawnServer(ggufPath) -> Result<{ baseUrl, stop }, LlmError>` — the real default spawns
  `llama-server` and polls `/health`; tests inject a fake.
- `providerFor(baseUrl) -> LlmProvider` — the real default is
  `createOpenAiCompatibleProvider` pointed at the spawned server's `/v1`; tests inject a fake.
Lifecycle transitions (start / swap) are SERIALIZED through a promise-chain mutex so concurrent
asks can never spawn two servers. Empirically grounded: earlier this session `llama-server -m
<gguf> --port <p> --host 127.0.0.1 --no-webui` was verified to load the user's models in 0–2s
and answer via `/v1/chat/completions` with clean `choices[0].message.content`.

## Constraints
- Do NOT add the orphan-safety PID hardening (writing the child PID into the SessionEnd-swept
  dir) — that is #58. This slice does graceful `shutdown()` on SIGTERM/SIGINT only.
- Do NOT add any dashboard/frontend code, and do NOT change `ChatMessage`/`ModelInfo` in
  `src/types.ts` or the dashboard mirror. `ask` forwards the client's `messages` as-is; the
  "be concise / help a reviewer" instruction is a CLIENT concern built with the code context in
  #59 — no server-side system prompt in this slice.
- Do NOT spawn a real `llama-server` in the automated test suite — unit-test the orchestration
  and the spawner's error paths with INJECTED fakes (real behavior is proven by the e2e smoke in
  the final task). This keeps the suite green without llama.cpp installed.
- Keep `listModels` unchanged. `LocalChat` grows to `{ listModels, ask, shutdown }`.
- Stay in the Result world (no throwing); follow NodeNext `.js` imports; no new runtime deps.

## Patterns to follow
- Dependency-injection with real defaults + fakes in tests: follow `src/gh-client.ts`
  (injected `CommandExecutor`) and `src/build-graph.ts` (injected `GitGrep`/`ReadContent`), and
  their tests `src/gh-client.test.ts` / `src/build-graph.test.ts`.
- Provider usage: `createOpenAiCompatibleProvider(...).chat(messages)` from `src/llm-provider.ts`
  (added in #55). `LlmError`/`LlmErrorCode` also there.
- Result helpers (`ok`, `err`, `isOk`): `src/result.ts`. Retry helper if useful: `src/retry.ts`.
- Router (`POST /ask`) + `wrap` + Result-to-HTTP mapping: follow the existing `createAiRouter`
  in `src/ai-endpoints.ts` (it already has `wrap` and `GET /models`).
- Fetch mocking in tests (for the spawner's health poll): `vi.stubGlobal`/injected `fetchFn`,
  as in `src/llm-provider.test.ts`.

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check: `npm run typecheck`

## Current state
- `src/llama-runner.ts`: `interface LocalChat { listModels(): Promise<Result<ModelInfo[],
  LlmError>> }`; `createLocalChat({ modelsDir }): LocalChat` (only `listModels`); pure
  `discoverModels`. Model `id` is the path relative to `modelsDir` (so `join(modelsDir, id)` is
  the absolute `.gguf` path). `ModelInfo = { id, name, path }`.
- `src/ai-endpoints.ts`: `createAiRouter({ localChat })` with a local `wrap` helper and
  `router.get('/models', ...)`; mounted at `/api/ai` in `src/server.ts`.
- `src/server.ts`: `ServerDeps = { dataDir, ghClient, store, localChat }`; `startServer` builds
  `localChat = createLocalChat({ modelsDir: PRMAP_MODELS_DIR ?? ~/models })`;
  `registerGracefulShutdown(server, pidFile)` handles SIGTERM/SIGINT → `server.close(() =>
  process.exit(0))`.
- `src/llm-provider.ts` (#55): `createOpenAiCompatibleProvider({ baseUrl, apiKey, model })` with
  `chat(messages)`; `LlmError = { code: LlmErrorCode; message }`,
  `LlmErrorCode = 'llama_not_found' | 'model_load_failed' | 'request_failed'`.
- Verified this session: `llama-server` at `/opt/homebrew/bin`; health at `/health`
  (`{"status":"ok"}`); OpenAI-compatible `/v1/chat/completions`.

## Desired end state
- `LocalChat` is `{ listModels, ask, shutdown }`. `ask({ model, messages })` ensures the right
  `llama-server` is running (start, or swap from a different model), then returns the model's
  reply via the OpenAI-compatible provider; a missing `llama-server` binary yields
  `err({ code: 'llama_not_found' })`, a ready-timeout `err({ code: 'model_load_failed' })`.
- Lifecycle is serialized: concurrent `ask`s for the same model spawn exactly one server;
  switching models tears the previous one down (never two live at once).
- `POST /api/ai/ask` with `{ model, messages }` returns `{ reply }`; `llama_not_found` → HTTP
  503 `{ error, code }`; other errors → 502 `{ error, code }`.
- `startServer` calls `await localChat.shutdown()` on SIGTERM/SIGINT before exit; no `llama-server`
  is left running after a graceful stop.
- `npm test`, `npm run lint`, `npm run typecheck` pass; a manual e2e `ask` against `~/models`
  returns a real answer.

## Edge cases and risks
- Concurrency: two `ask` calls arriving together (fast follow-up, model-pick-then-ask) must not
  each spawn a server — the mutex serializes `ensure`; a same-model concurrent pair reuses one.
- Swap: starting model B must `stop()` model A's server first; assert at most one live server.
- `llama-server` not on PATH: the child emits an `error` with `code === 'ENOENT'` — map to
  `llama_not_found`, do not hang waiting for health.
- Ready timeout / child exits early: return `model_load_failed` and `stop()` the child so nothing
  leaks.
- `ask` before any model / unknown model id: resolve `join(modelsDir, model)`; a bad path simply
  fails to spawn → surfaces as an error Result (no throw).
- Health poll must not run forever — bound it with a timeout and a poll interval.

## Tasks

- [x] Add the `llama-server` spawner seam. In `src/llama-runner.ts`, export `interface RunningServer { baseUrl: string; stop: () => void }` and a factory `createLlamaSpawner(deps?: { spawn?: typeof import('node:child_process').spawn; fetchFn?: typeof fetch; pickPort?: () => Promise<number>; readyTimeoutMs?: number; pollIntervalMs?: number }): (ggufPath: string) => Promise<Result<RunningServer, LlmError>>`. Real defaults: `spawn` = `child_process.spawn`; `fetchFn` = global `fetch`; `pickPort` = a free-port finder using `node:net` (listen on 0, read `address().port`, close); `readyTimeoutMs` = 60000; `pollIntervalMs` = 300. Behavior: pick a port; `spawn('llama-server', ['-m', ggufPath, '--port', String(port), '--host', '127.0.0.1', '--no-webui'])`; if the child emits `error` with `code === 'ENOENT'` resolve `err({ code: 'llama_not_found', message })`; otherwise poll `http://127.0.0.1:<port>/health` via `fetchFn` until the JSON `status` is `ok` → resolve `ok({ baseUrl: 'http://127.0.0.1:<port>', stop: () => child.kill() })`; if not ready within `readyTimeoutMs`, `child.kill()` and resolve `err({ code: 'model_load_failed', message })`. Never throw. Write tests in `src/llama-runner.test.ts` (new `describe('createLlamaSpawner')`) injecting a FAKE `spawn` (returns a fake child: a small `EventEmitter` with a `kill` spy and a `pid`) and a FAKE `fetchFn` and a fixed `pickPort`, with a short `readyTimeoutMs`/`pollIntervalMs`: (a) fake child emits `error` `{ code:'ENOENT' }` → resolves `err` with `code:'llama_not_found'`; (b) `fetchFn` returns healthy (`{ ok:true, json:async()=>({status:'ok'}) }`) → resolves `ok`, `baseUrl` contains the fixed port, and calling `stop()` calls the child's `kill`; (c) `fetchFn` always unhealthy → resolves `err` `code:'model_load_failed'` and the child was `kill`ed. Run `npm test`.
- [ ] Now that the spawner exists, add `ask` + `shutdown` with serialized lifecycle. In `src/llama-runner.ts`, widen `interface LocalChat` to add `ask(request: { model: string; messages: ChatMessage[] }): Promise<Result<string, LlmError>>` and `shutdown(): Promise<void>` (import `ChatMessage` from `./types.js`, `LlmProvider`/`createOpenAiCompatibleProvider` from `./llm-provider.js`). Extend `createLocalChat` options to `{ modelsDir: string; spawnServer?: (ggufPath: string) => Promise<Result<RunningServer, LlmError>>; providerFor?: (baseUrl: string) => LlmProvider }` with defaults `spawnServer = createLlamaSpawner()` and `providerFor = (baseUrl) => createOpenAiCompatibleProvider({ baseUrl: baseUrl + '/v1', apiKey: 'sk-local', model: 'local' })`. Keep `listModels` as-is. Hold module state `let current: { model: string; server: RunningServer } | null = null` and a promise-chain mutex to SERIALIZE an internal `ensure(model)`: within the mutex, if `current?.model === model` reuse it (return `ok`); otherwise `current?.server.stop()`, `const r = await spawnServer(join(modelsDir, model))`, on `err` set `current = null` and return `r`, on `ok` set `current = { model, server: r.value }` and return `ok`. `ask({ model, messages })`: `const ensured = await ensure(model); if (!isOk(ensured)) return ensured; return providerFor(current!.server.baseUrl).chat(messages)` (forward messages unchanged — no system prompt here). `shutdown()`: `current?.server.stop(); current = null;` (idempotent, safe to call when never started). Extend `src/llama-runner.test.ts` with a `describe('ask/shutdown')` injecting a FAKE `spawnServer` (a `vi.fn` that records calls and returns `ok({ baseUrl:'http://x', stop: <spy> })`) and a FAKE `providerFor` (returns `{ chat: async (m) => ok('reply:'+m.length), complete: async()=>ok('') }`): (a) two `ask({model:'m1',...})` awaited concurrently (`Promise.all`) call `spawnServer` EXACTLY once; (b) `ask` m1 then `ask` m2 → the m1 server's `stop` spy was called and `spawnServer` called twice (swap, never two live — assert the m1 stop happened before/around m2 spawn); (c) a `spawnServer` that returns `err({code:'llama_not_found'})` makes `ask` return that same err; (d) the happy `ask` returns `ok` with the fake provider's reply; (e) `shutdown()` after a successful `ask` calls the server `stop` spy and a second `shutdown()` is a no-op. Run `npm test` and `npm run typecheck`.
- [ ] Now that `ask`/`shutdown` exist, expose the endpoint and wire graceful shutdown. In `src/ai-endpoints.ts` add `router.post('/ask', wrap(async (request, response) => { ... }))`: read `{ model, messages }` from `request.body` (Express JSON body parsing is already enabled in `server.ts`); if `model` is not a string or `messages` is not an array, respond `400 { error }`; else `const result = await deps.localChat.ask({ model, messages })`; on `isOk` → `response.json({ reply: result.value })`; on error, if `result.error.code === 'llama_not_found'` → `response.status(503).json({ error: result.error.message, code: result.error.code })`, otherwise `response.status(502).json({ error: result.error.message, code: result.error.code })`. In `src/server.ts`, make graceful shutdown also stop the model server: pass `deps.localChat` (or a `() => deps.localChat.shutdown()` callback) into `registerGracefulShutdown`, and in its `shutdown` handler `await deps.localChat.shutdown()` before `server.close(() => process.exit(0))` (guard so it still exits if shutdown throws). This router change is thin wiring over the task-2 `ask` (already unit-tested); verify with `npm run typecheck`, `npm run lint`, and `npm test` (existing suite stays green).
- [ ] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm run typecheck`.
