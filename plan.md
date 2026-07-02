# #61 — Cold-start indicator + two distinct error states + reduced motion

## Goal
Make the first (cold) ask read as calm and deliberate rather than hung, and make failures tell the
reviewer what to do: an amber "install llama.cpp" note for `llama_not_found`, a red "request
failed" note with Retry for anything else. The warm ask keeps a fast indicator, visibly different
from the cold state. All new motion has a reduced-motion fallback.

## Approach
Match the repo's #59/#60 convention: extract the real logic — classifying an ask failure and
mapping elapsed wait-time to an indicator phase — into a pure, unit-tested
`dashboard/src/ask-status.ts`, and implement the React glue (the timer, the indicators, the two
error blocks, the copy/Retry buttons, the CSS keyframes) as build-verified edits to
`dashboard/src/ask-popup.tsx` + `dashboard/src/index.css`, plus a small `dashboard/src/chat-api.ts`
change so a failed `ask` surfaces the response `code`. Cold-vs-warm is decided by TIME (no backend
health signal exists until #62): show the fast indicator immediately, escalate to the calm
"warming" indicator only if the reply is slow.

## Constraints
- Do NOT add `@testing-library/react`, jsdom, or any component-test dependency. Unit-test only the
  extracted pure functions; the popup/CSS edits are build-verified.
- Do NOT change the popup's own enter/exit motion (owned by #59), the `/api/ai/*` contract, or any
  backend file (`src/**`). Frontend only under `dashboard/src/**`.
- Do NOT add a warm-overlap health ping / `GET /api/ai/health` (that is #62). Cold-vs-warm is
  time-based only.
- Cold-vs-warm is TIME-BASED escalation: warm = fast indicator shown immediately; if the reply has
  not arrived after ~1.6s, switch to the calm cold indicator; after ~5s more, the "still warming"
  copy. A warm (fast) reply must NEVER show the calm indicator.
- Every new animated indicator MUST have a `prefers-reduced-motion` fallback (dots → the text
  "Thinking…"; shimmer → static + a slow pulse).
- Keep the existing default-model resolution, multi-turn history, portal/scroll-follow, and
  keyboard guard unchanged — this slice only changes the pending indicator and the error rendering.

## Patterns to follow
- Pure-function unit tests: `dashboard/src/ask-status.test.ts` following `dashboard/src/model-select.test.ts`.
- Existing motion token + gating: `dashboard/src/index.css` `--ease-out` (line 7); the popup's
  `prefersReducedMotion` (via `window.matchMedia('(prefers-reduced-motion: reduce)')`) already used
  for the enter animation in `ask-popup.tsx`.
- Client fetch wrapper to extend: `asJson` in `dashboard/src/chat-api.ts` (lines 1-6).
- Error/indicator render sites to replace: `ask-popup.tsx` `{pending && …Thinking…}` and
  `{error && …}` (the conversation area, around lines 288-293).

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check / build: `npm --prefix dashboard run build`

## Current state
- `dashboard/src/ask-popup.tsx`: `error` state is `string | null` (line 52). `sendMessage`
  (174-199) echoes the user turn, `setPending(true)`, `aiApi.ask(...)`, on success appends the
  assistant turn + updates `conversationHistory`, on `catch` `setError('Request failed')`,
  `finally` `setPending(false)`. Render (288-293): `{pending && <div …>Thinking...</div>}` and
  `{error && <div className="text-red-600 …">{error}</div>}`. `resolveModel`/`modelId` fallback at
  164-172/186. `prefersReducedMotion` is computed for the enter animation.
- `dashboard/src/chat-api.ts`: `asJson` (1-6) throws `new Error(text || 'Request failed (status)')`
  — it does NOT surface the `code`. `aiApi.ask` returns `{ reply }`.
- Backend `POST /api/ai/ask` (src/ai-endpoints.ts): success `{ reply }`; `llama_not_found` → HTTP
  503 `{ error, code: 'llama_not_found' }`; other errors → 502 `{ error, code }`; bad body → 400.
- `dashboard/src/index.css`: 104 lines; `--ease-out` token at line 7; no `@keyframes` yet.

## Desired end state
- While awaiting a reply: a warm 3-dot bounce indicator shows immediately; if the reply is slow
  (~1.6s+) it becomes a calm shimmer indicator with copy "Starting local model…", escalating to
  "Still warming up — the first run is slow." after ~5s more. A fast reply only ever shows the dots.
- On `code:'llama_not_found'` (503): an amber setup note with a copyable `brew install llama.cpp`;
  the composer stays usable.
- On any other failure: a red note with a Retry button that re-sends the failed question; the
  failed user turn stays visible; Retry does not echo a duplicate user turn.
- With `prefers-reduced-motion: reduce`: the dots render as the static text "Thinking…" and the
  shimmer renders static + a slow pulse.
- `npm test`, `npm run lint`, `npm --prefix dashboard run build` all pass.

## Edge cases and risks
- The reply is synchronous (no streaming), so elapsed time is the ONLY cold/warm signal — the timer
  must start when `pending` becomes true and stop when it clears; do not leak the interval (clear it
  in the effect cleanup / when pending goes false).
- A retry must rebuild messages from the UNCHANGED `conversationHistory` (a failed send never
  updates it), exactly like the normal send — so `buildOutgoingMessages(conversationHistory,
  contextCode, question)` is correct on retry too.
- `navigator.clipboard` may be unavailable (non-secure context) — the copy button must not throw
  (guard / swallow); copying is best-effort.
- `classifyAskError` must treat an error with NO `code` (network failure, or a non-JSON body) as
  `'failed'`, not `'unavailable'`.
- Do not show BOTH an indicator and an error at once — clear `error` when a send/retry starts.

## Tasks

- [ ] Create the pure status module. New file `dashboard/src/ask-status.ts` exporting: `export const COLD_MS = 1600;` and `export const COLD_SLOW_MS = 6600;`; `export const COLD_COPY = 'Starting local model…';` and `export const COLD_SLOW_COPY = 'Still warming up — the first run is slow.';`; `export function classifyAskError(err: unknown): 'unavailable' | 'failed'` that returns `'unavailable'` when `err` is an object with a `code` property equal to `'llama_not_found'`, else `'failed'` (treat missing/`undefined` code, non-objects, and network errors as `'failed'`); and `export function thinkingPhase(elapsedMs: number): 'warm' | 'cold' | 'cold-slow'` returning `'warm'` when `elapsedMs < COLD_MS`, `'cold'` when `elapsedMs < COLD_SLOW_MS`, else `'cold-slow'`. Write `dashboard/src/ask-status.test.ts` following `dashboard/src/model-select.test.ts`: for `classifyAskError` assert `{ code: 'llama_not_found' }` → `'unavailable'`, `{ code: 'request_failed' }` → `'failed'`, `{ code: 'model_load_failed' }` → `'failed'`, `{}` → `'failed'`, and a plain `new Error('x')` → `'failed'`; for `thinkingPhase` assert `0` and `COLD_MS - 1` → `'warm'`, `COLD_MS` and `COLD_SLOW_MS - 1` → `'cold'`, `COLD_SLOW_MS` → `'cold-slow'`. Run `npm test`.

- [ ] Surface the ask error `code` in the client. In `dashboard/src/chat-api.ts`, change `asJson` so that on `!response.ok` it reads the JSON error body and throws an `Error` carrying the `code`: define `export interface AskError extends Error { code?: string; status?: number }`; in `asJson`, on failure do `let body: { error?: string; code?: string } = {}; try { body = await response.json(); } catch {}` then `const err = new Error(body.error || \`Request failed (${response.status})\`) as AskError; err.code = body.code; err.status = response.status; throw err;`. This keeps the existing message behavior while adding `code`. Do NOT change `aiApi.listModels`/`aiApi.ask` signatures or the success path. There is no unit test for this thin fetch wrapper (repo convention — `chat-api.ts`/`review-api.ts` are untested glue); verify it compiles with `npm --prefix dashboard run build`.

- [ ] Now that `thinkingPhase` exists, wire the cold-start / warm indicator into the popup (build-verified UI — verify with `npm --prefix dashboard run build`; NO component test, do NOT add a component-test dependency). In `dashboard/src/ask-popup.tsx`: import `{ thinkingPhase, COLD_COPY, COLD_SLOW_COPY }` from `./ask-status`. Add an elapsed-time driver: a `const [elapsedMs, setElapsedMs] = useState(0);` plus a `useEffect` that, WHEN `pending` is true, records a start time and starts a `setInterval` (~300ms) doing `setElapsedMs(Date.now() - start)`, and clears the interval + resets `elapsedMs` to 0 in the cleanup / when `pending` is false (effect deps `[pending]`). Replace the `{pending && <div …>Thinking...</div>}` block (~lines 288-289) with a `pending`-guarded indicator computed from `const phase = thinkingPhase(elapsedMs)`: `warm` → a 3-dot bounce (three `<span>`s animated via a new CSS keyframe, staggered ~700ms); `cold`/`cold-slow` → a calm shimmer bar (new CSS keyframe, ~1.6s) with the copy `COLD_COPY` (cold) or `COLD_SLOW_COPY` (cold-slow). Gate motion behind the existing `prefersReducedMotion`: when reduced, render the dots as the static text `Thinking…` and the shimmer as a static bar with a slow opacity pulse (still showing the staged copy). In `dashboard/src/index.css`, add the `@keyframes` for the dot bounce and the shimmer (and any small utility classes you reference), following the existing token style near line 7. Verify with `npm --prefix dashboard run build`; a warm/fast reply must only ever show the dots (never the shimmer). Human will visually confirm at PR time.

- [ ] Now that `classifyAskError` exists and `chat-api` surfaces `code`, wire the two error states + Retry (build-verified UI — verify with `npm --prefix dashboard run build`). In `dashboard/src/ask-popup.tsx`: change the `error` state type from `string | null` to `'unavailable' | 'failed' | null` (line 52) and add `const [lastQuestion, setLastQuestion] = useState('');`. Refactor `sendMessage` so the network attempt is reusable: extract `const runAsk = async (question: string) => { setError(null); setPending(true); try { const model = modelId || (await resolveModel()); const messages = buildOutgoingMessages(conversationHistory, contextCode, question); const { reply } = await aiApi.ask({ model, messages }); setConversationHistory([...messages, { role: 'assistant', content: reply }]); setTurns((prev) => [...prev, { role: 'assistant', content: reply }]); } catch (e) { setError(classifyAskError(e)); } finally { setPending(false); } };` (import `classifyAskError` from `./ask-status`). `sendMessage` becomes: guard on `!input.trim() || pending`, `const question = input.trim(); setInput(''); setTurns((prev) => [...prev, { role: 'user', content: question }]); setLastQuestion(question); void runAsk(question);` — i.e. it echoes the user turn once then delegates. Replace the `{error && <div className="text-red-600 …">{error}</div>}` block (~291-293) with: when `error === 'unavailable'`, an amber note (`border-l-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-sm dark:bg-amber-950/30`, matching the review palette) reading that llama.cpp isn't installed, containing a `<code>brew install llama.cpp</code>` and a small Copy button whose `onClick` does `navigator.clipboard?.writeText('brew install llama.cpp').catch(() => {})` (best-effort, must not throw); when `error === 'failed'`, a red note (`border-l-2 border-red-400 bg-red-50 text-red-700 px-2 py-1.5 text-sm dark:bg-red-950/30`) with a Retry `<button>` whose `onClick` calls `runAsk(lastQuestion)` (re-attempts WITHOUT echoing a new user turn — the failed user turn is still in `turns`). The composer stays rendered/usable in both cases (it already is once `pending` is false). Do NOT change the model dropdown, portal/positioning/scroll-follow, or keyboard guard. Verify with `npm --prefix dashboard run build`.

- [ ] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm --prefix dashboard run build`.
