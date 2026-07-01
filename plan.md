# #56 — GET /api/ai/models lists on-disk GGUFs (mmproj filtered)

## Goal
Expose the local models a reviewer can ask about. Add a `LocalChat` module that discovers the
`.gguf` files under a models directory and a `GET /api/ai/models` endpoint that returns them, so
the upcoming popup's model dropdown (#60) has something to list and the whole feature has its
first curl-able, user-observable slice. Depends on #55's `ModelInfo` type and `LlmError`.

## Approach
A deep `LocalChat` module hides model discovery behind a small interface. Its discovery core is a
pure function (`discoverModels`) testable with no disk; `listModels` does the real filesystem
walk. The endpoint is thin wiring over `listModels`, mirroring the existing thin routers
(`createChecksRouter`). `LocalChat` starts with only `listModels`; #57 widens it with `ask`/
`shutdown`. Grounded in `src/review-endpoints.ts` (router + `wrap` pattern), `src/server.ts`
(deps + mounting), `src/result.ts`, and #55's `src/types.ts` `ModelInfo`.

## Constraints
- Do NOT implement `ask`, model spawning, `llama-server`, or the swap/serialization logic — those
  are #57. `LocalChat` exposes ONLY `listModels` in this slice; no stub methods for future work.
- Do NOT add any dashboard/frontend code — this slice is backend only.
- A missing or unreadable models directory must return an EMPTY list, never a 500 or a throw
  (stay in the Result world; fail soft).
- Filter out `mmproj-*` files (vision projectors, e.g. `mmproj-model-f16.gguf`) — they are not
  chat models.
- Follow NodeNext `.js` import extensions and the Result pattern; no new runtime dependencies.

## Patterns to follow
- Thin router + `wrap` async handler + Result-to-HTTP mapping: follow `createChecksRouter` in
  `src/review-endpoints.ts` (copy the ~5-line local `wrap` helper into the new module — keep the
  module self-contained rather than exporting `wrap`).
- Router deps + mounting: follow how `src/server.ts` builds `ServerDeps` in `startServer` and
  mounts routers with `app.use('/api/<name>', createXRouter(deps))` in `createApp` (mount the new
  one BEFORE the `/api` catch-all 404).
- Operation-style tests with real/injected dependencies (no supertest): follow
  `src/review-endpoints.test.ts` (it tests operations directly). Pure-function tests: follow
  `src/import-rules.test.ts` / `src/changed-symbols.test.ts`.
- Result helpers (`ok`, `err`, `isOk`): `src/result.ts`. `ModelInfo`: `src/types.ts`. `LlmError`:
  `src/llm-provider.ts`.

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check: `npm run typecheck`

## Current state
- `src/server.ts`: `createApp(deps: ServerDeps)` where `ServerDeps = { dataDir, ghClient, store }`;
  routers mounted with `app.use('/api/review', createReviewRouter({...}))` etc., then a
  `app.use('/api', ...)` JSON-404 catch-all. `startServer` builds the real `ghClient`/`store` and
  calls `createApp`.
- `src/review-endpoints.ts`: `createChecksRouter(deps): Router` = `Router()` + one
  `router.get('/', wrap(async (_req, res) => { const r = await getChecks(...); isOk(r) ? res.json(r.value) : res.status(502).json({ error: r.error.message }) }))`. `wrap` is a small local
  helper (not exported).
- `src/types.ts` (from #55): `ModelInfo = { id: string; name: string; path: string }`.
- `src/llm-provider.ts` (from #55): `LlmError = { code: LlmErrorCode; message: string }`.
- The user's models live as `~/models/<model-folder>/<file>.gguf` (e.g.
  `~/models/qwen2.5-coder-1.5b/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`), plus a
  `mmproj-model-f16.gguf` alongside gemma. Node is v25 (supports `readdir(dir, { recursive: true,
  withFileTypes: true })`).

## Desired end state
- `src/llama-runner.ts` exports `interface LocalChat { listModels(): Promise<Result<ModelInfo[],
  LlmError>> }` and `createLocalChat({ modelsDir }): LocalChat`.
- `listModels()` recursively finds `*.gguf` under `modelsDir`, drops `mmproj-*`, returns
  `ok(ModelInfo[])`; a missing/unreadable dir returns `ok([])`.
- `GET /api/ai/models` returns `200 { models: ModelInfo[] }`; against a dir with one real `.gguf`
  and one `mmproj-*.gguf` it returns only the real model.
- `startServer` builds `LocalChat` from `PRMAP_MODELS_DIR` (default `~/models`) and the router is
  mounted at `/api/ai`.
- `npm test`, `npm run lint`, `npm run typecheck` all pass.

## Edge cases and risks
- Models are in SUBDIRECTORIES of the models dir, so discovery must recurse (not just read the top
  level). Use `readdir(..., { recursive: true, withFileTypes: true })` and join `dirent.parentPath`
  + `dirent.name`.
- `mmproj-*` filtering is by basename; match case-insensitively and only real `.gguf` files.
- A non-existent `modelsDir` (user has no `~/models`) is normal, not an error → `ok([])`.
- `id` must be stable and unique per model (use the path relative to `modelsDir`); `name` should be
  human-friendly (the parent folder name when nested, else the filename without `.gguf`).

## Tasks

- [x] Add the pure model-discovery function. In a new `src/llama-runner.ts`, export `discoverModels(ggufPaths: string[], modelsDir: string): ModelInfo[]` — import `ModelInfo` from `./types.js`. For each path: keep only those ending in `.gguf` (case-insensitive) whose basename does NOT start with `mmproj` (case-insensitive); build `{ path, id, name }` where `path` is the given path, `id` is the path relative to `modelsDir` (use `node:path` `relative`), and `name` is the parent directory's basename when the file is nested under `modelsDir`, otherwise the filename without its `.gguf` extension. Pure — no filesystem access. Write `src/llama-runner.test.ts` following `src/changed-symbols.test.ts`: a `describe('discoverModels')` given a fixed list `[<modelsDir>/qwen3-4b/Qwen3-4B-Q4_K_M.gguf, <modelsDir>/gemma-3-4b/gemma-3-4b-it-Q4_K_M.gguf, <modelsDir>/gemma-3-4b/mmproj-model-f16.gguf, <modelsDir>/notes.txt]` returns exactly the two real models (mmproj and non-gguf dropped) with `name` = `qwen3-4b` / `gemma-3-4b` and the expected relative `id`s. Run `npm test`.
- [x] Now that `discoverModels` exists, add the `LocalChat` module. In `src/llama-runner.ts`, export `interface LocalChat { listModels(): Promise<Result<ModelInfo[], LlmError>> }` (import `Result` from `./result.js`, `LlmError` from `./llm-provider.js`, `ModelInfo` from `./types.js`) and `createLocalChat(options: { modelsDir: string }): LocalChat`. Implement `listModels()`: `await readdir(options.modelsDir, { recursive: true, withFileTypes: true })` (from `node:fs/promises`), keep file dirents, build absolute paths by joining `dirent.parentPath` + `dirent.name`, pass them and `modelsDir` to `discoverModels`, and return `ok(models)`. Wrap the whole thing in try/catch — any error (including a non-existent dir, `ENOENT`) returns `ok([])`, never a throw or an `err`. Extend `src/llama-runner.test.ts` with a `describe('listModels')` that uses a real temp dir (`mkdtemp` from `node:fs/promises` in `os.tmpdir()`): create `<tmp>/m1/model-a-q4.gguf`, `<tmp>/m1/mmproj-model-f16.gguf`, and `<tmp>/empty-sub/` (no gguf); assert `createLocalChat({ modelsDir: tmp }).listModels()` resolves to `ok` containing exactly one model (`model-a-q4`'s folder → name `m1`), and that `createLocalChat({ modelsDir: join(tmp, 'does-not-exist') }).listModels()` resolves to `ok([])`. Clean up the temp dir in the test. Run `npm test` and `npm run typecheck`.
- [ ] Now that `createLocalChat`/`listModels` exists, expose it over HTTP and wire it in. Create `src/ai-endpoints.ts` exporting `interface AiRouterDeps { localChat: LocalChat }` (import `LocalChat` from `./llama-runner.js`) and `createAiRouter(deps: AiRouterDeps): Router` — copy the small local `wrap` async-handler helper from `src/review-endpoints.ts`, and add `router.get('/', wrap(async (_request, response) => { const result = await deps.localChat.listModels(); if (isOk(result)) { response.json({ models: result.value }); } else { response.status(500).json({ error: result.error.message }); } }))`. Then in `src/server.ts`: add `localChat: LocalChat` to `ServerDeps`; in `createApp`, mount `app.use('/api/ai', createAiRouter({ localChat: deps.localChat }))` BEFORE the `app.use('/api', ...)` 404 catch-all; in `startServer`, build `localChat: createLocalChat({ modelsDir: process.env.PRMAP_MODELS_DIR ?? join(homedir(), 'models') })` (import `homedir` from `node:os`, `createLocalChat` from `./llama-runner.js`, `createAiRouter` from `./ai-endpoints.js`) and pass it into the `createApp` deps. This is thin wiring mirroring `createChecksRouter`; the `listModels` behavior is already covered by task 2, so no new test is required — verify with `npm run typecheck`, `npm run lint`, and `npm test` (existing suite stays green).
- [ ] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm run typecheck`.
