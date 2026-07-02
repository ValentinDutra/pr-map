# #62 — Warm-overlap health ping + warming-up header chip

## Goal
Give the reviewer a subtle, non-blocking signal about whether the local model is already warm.
When the ask popup opens against a cold (not-yet-spawned) server, a small "warming up" chip in the
popup header tells them the first ask will be slower; when the server is already warm (from an ask
earlier in the session), no chip shows. This is purely additive — asking behaves identically whether
the chip is present or not.

## Approach
Extend the existing `LocalChat` deep module (`src/llama-runner.ts`) with one cheap, pure status
method `isReady()` returning `current !== null`. That flag is an accurate "a warm server exists"
signal: `current` is assigned only after a spawned server's health poll returns `status: ok`, and is
reset to `null` on a failed swap and in `shutdown()`. Surface it through a thin `GET /api/ai/health`
route (`src/ai-endpoints.ts`) returning `{ ready }`, mirroring the existing `/models` route. On the
frontend add `aiApi.health()` to `dashboard/src/chat-api.ts` and a build-verified header chip in
`dashboard/src/ask-popup.tsx` that fires `health()` once on mount and shows the chip only while cold,
clearing it when an ask succeeds. This cold-vs-warm is a REAL backend signal (`isReady`), distinct
from #61's time-based per-ask indicator: the chip is a persistent header hint about server warmth;
#61's dots/shimmer is per-ask progress in the conversation area. They coexist without overlapping.

## Constraints
- Do NOT actively spawn/prewarm a server from `health()` or on popup open / model-select. `health()`
  is a pure read (`current !== null`). Auto-prewarming is an explicit out-of-scope follow-up.
- Do NOT block or gate asking on health — the chip is informational and must never disable the
  composer, delay a send, or surface an error.
- Do NOT change the `/api/ai/ask` or `/api/ai/models` contracts, #61's cold-start indicator / two
  error states, the model dropdown, portal/positioning/scroll-follow, or the keyboard guard.
- Backend edits only in `src/llama-runner.ts` and `src/ai-endpoints.ts`; frontend edits only under
  `dashboard/src/**`. Add NO new dependency (no jsdom / Testing Library / component-test infra).
- The chip must coexist with #61's per-ask indicator without overlapping it — the chip lives in the
  header row, the indicator stays in the conversation area.

## Patterns to follow
- `LocalChat` interface + impl: `src/llama-runner.ts` — the `LocalChat` interface (~line 131) and
  `createLocalChat` (~line 143); `current` is the warm-server field (~line 154). `isReady()` is a
  sibling of `listModels` / `ask` / `shutdown`.
- `LocalChat` unit tests: `src/llama-runner.test.ts` `describe('ask/shutdown')` (~line 355) — uses
  `createLocalChat` with a fake `spawnServer` (returns `ok({ baseUrl, stop })`) and a fake
  `providerFor`; follow that setup to assert `isReady()` transitions.
- Router route: the `GET '/models'` handler in `src/ai-endpoints.ts` (~lines 24-34) — follow its
  `wrap(async ...)` shape for the new `GET '/health'`.
- Client fetch method: `aiApi.listModels` in `dashboard/src/chat-api.ts` (~line 34) — add `health()`
  the same way, reusing `asJson`.
- Header render + mount fetch: `ask-popup.tsx` header row (~lines 251-281, the `contextLabel` + model
  `<select>`) for chip placement; the existing mount effect that calls `aiApi.listModels()` (~lines
  74-84, `.catch(() => {})` graceful degradation) for the `health()` fetch pattern.

## Verification commands
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Tests: `npm test`
- Frontend build: `npm --prefix dashboard run build`

## Current state
- `src/llama-runner.ts`: `LocalChat = { listModels, ask, shutdown }`. `createLocalChat` holds
  `let current: { model, server } | null = null`; `current` is set only after `spawnServer` resolves
  `ok` (health-polled) and reset to `null` on a failed swap (~line 168) and in `shutdown()` (~line
  209). No `isReady()` yet.
- `src/ai-endpoints.ts`: `createAiRouter` exposes `GET /models` and `POST /ask` via a `wrap()` async
  helper. No `/health` route.
- `dashboard/src/chat-api.ts`: `aiApi = { listModels, ask }` using `asJson`; `AskError` surfaces
  `code`/`status` (from #61). No `health()`.
- `dashboard/src/ask-popup.tsx`: header row shows `contextLabel` + a model `<select>`; a mount effect
  calls `aiApi.listModels()`. #61 added the per-ask indicator (dots/shimmer) in the conversation area
  and the amber/red error states. No warming chip. `pending` / `error` / `elapsedMs` state exists.
- `src/server.ts` wires `createAiRouter({ localChat })` at `/api/ai` (~line 63); `localChat` is a
  long-lived singleton for the server process, so it stays warm across popup opens.
- No `src/ai-endpoints.test.ts` exists — the `/models` and `/ask` routes are untested thin glue
  (repo convention: the real logic lives in and is tested at the `LocalChat` level).

## Desired end state
- `LocalChat.isReady(): boolean` returns `true` iff a warm server is currently loaded
  (`current !== null`): `false` before any ask, `true` after a successful ask, `false` again after
  `shutdown()`.
- `GET /api/ai/health` returns `{ ready: boolean }` from `localChat.isReady()`; `curl` shows
  `ready:false` when cold and `ready:true` after an ask has warmed a model.
- On popup mount the client calls `aiApi.health()`; if `ready` is `false`, a subtle "warming up" chip
  renders in the popup header and never blocks input; the chip clears when an ask succeeds. If
  `health()` reports `ready:true` or the fetch fails, no chip is shown.
- The acceptance-criteria clause "the chip clears once a subsequent ask succeeds (or health reports
  ready)" is satisfied by the mount check (a `ready:true` health response shows no chip) plus
  clear-on-ask-success. Absent the out-of-scope prewarm, the server only becomes warm via an ask, so
  there is no reachable state where a re-poll would clear an already-shown chip — no health polling
  loop is added.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix dashboard run build` all pass.

## Edge cases and risks
- `isReady()` is a synchronous snapshot: during an in-flight cold ask (server still spawning)
  `current` is still `null`, so it correctly returns `false` until the ask resolves `ok`. Do not try
  to reflect "spawning" as ready.
- `health()` must degrade gracefully (`.catch(() => {})`) — a failed health fetch simply shows no
  chip; it must never surface an error or block asking.
- The chip must not double-signal with #61's indicator: keep it in the header, and clear it on the
  first successful ask (after which the server is warm).
- No polling loop — a single mount `health()` call plus clear-on-ask-success is sufficient; re-polling
  health on an interval is out of scope and would add a timer to leak.
- Backend adds no npm dependency; the frontend chip is build-verified (no component test), consistent
  with #59/#60/#61.

## Tasks

- [x] Add the backend health capability: `LocalChat.isReady()` plus the `GET /api/ai/health` route.
  In `src/llama-runner.ts`, add `isReady(): boolean` to the `LocalChat` interface (alongside
  `listModels` / `ask` / `shutdown`) and implement it in `createLocalChat` as
  `isReady() { return current !== null; }` (place it next to `shutdown` in the returned object); do NOT
  change `ask` / `shutdown` / `ensure` logic. In `src/ai-endpoints.ts` add
  `router.get('/health', wrap(async (_request, response) => { response.json({ ready: deps.localChat.isReady() }); }));`
  following the existing `GET '/models'` handler shape (place it before the `POST '/ask'` route) — thin
  glue matching the untested `/models` and `/ask` routes, so do NOT add an `ai-endpoints.test.ts` or
  any route/component test framework; the real logic is unit-tested at the `LocalChat` level. Add that
  unit test to `src/llama-runner.test.ts` following the `describe('ask/shutdown')` setup (create a
  `createLocalChat` with a fake `spawnServer` that returns `ok({ baseUrl: 'http://127.0.0.1:1', stop:
  () => {} })` and a fake `providerFor` returning `{ chat: async () => ok('hi'), complete: async () =>
  ok('hi') }`): assert `isReady()` is `false` before any ask, `true` after one successful
  `await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'x' }] })`, and `false` again
  after `await localChat.shutdown()`. Run `npm test` and `npm run typecheck`.

- [x] Now that `GET /api/ai/health` exists, wire the warming-up chip (build-verified UI — verify with
  `npm --prefix dashboard run build` and `npm run typecheck`; NO component test). In
  `dashboard/src/chat-api.ts` add `health: () => fetch('/api/ai/health').then((response) =>
  asJson<{ ready: boolean }>(response))` to the `aiApi` object (reuse the existing `asJson`; do NOT
  change `listModels` / `ask`). In `dashboard/src/ask-popup.tsx`: add a `const [warming, setWarming] =
  useState(false);` state; add a mount `useEffect` (deps `[]`) that calls
  `aiApi.health().then(({ ready }) => setWarming(!ready)).catch(() => {})` (follow the existing
  `listModels` mount effect at ~lines 74-84); in the existing successful-ask path inside `runAsk`
  (after the reply is appended) call `setWarming(false)` so a successful ask clears the chip; and
  render a subtle chip in the header row (~lines 251-272, next to the `contextLabel` / model `<select>`
  in the left `flex items-center gap-2` group) that shows only when `warming` is `true`, e.g.
  `{warming && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700
  dark:bg-amber-900/40 dark:text-amber-300">warming up</span>}`. The chip must NOT block input, must
  NOT alter the composer, and must be independent of #61's `pending` indicator (do not gate it on
  `pending`/`error`). Do NOT change the model dropdown, portal/positioning/scroll-follow, keyboard
  guard, or #61's indicator/error blocks. Verify with `npm --prefix dashboard run build` and
  `npm run typecheck`.

- [x] Run full verification and fix any failures: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm --prefix dashboard run build`.
