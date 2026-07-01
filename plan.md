# #59 — Frontend MVP: robot affordance + line-anchored ask popup (default model)

## Goal
Let a reviewer select code in the diff, tap a robot in the gutter, ask a question, and get an
answer from a local model — inline, in a small popup, without breaking keyboard nav. This is the
smallest lovable end-to-end version of the feature, wired to the backend from #55–#57. Model
dropdown is #60; cold-start/error-state polish is #61.

## Approach
Match the repo convention: extract pure logic and unit-test it (`buildCodeContext`, popup
`computeAnchorPosition`, the `shouldHandleReviewKey` guard); implement the React glue (robot
button, `AiChatPopup`, portal, motion, focus, `aiApi`) as thin components verified by the
dashboard build (`npm --prefix dashboard run build`, i.e. `tsc --noEmit && vite build`) against
the concrete UI contract embedded in the tasks below. There is NO React component-test infra
(no jsdom/Testing Library) and this slice does NOT add one — the dashboard tests
(`use-review-keys.test.ts`, `suggestion.test.ts`) test pure functions only; follow that.

## Constraints
- Do NOT add `@testing-library/react`, jsdom, or any component-test dependency. React
  components are build-verified, not unit-tested; unit-test only the extracted pure functions.
- Do NOT add the model dropdown (that is #60) — resolve a DEFAULT model via `GET /api/ai/models`
  (prefer a model whose `name` contains "coder", else the first) and use it for `ask`.
- Do NOT add the cold-start indicator or the styled amber/red error states (those are #61). The
  MVP shows: idle → an instant user echo + a simple "Thinking…" indicator → the answer; a bare
  failure may show a minimal inline "Request failed" line (no retry/copy affordances yet).
- Do NOT change backend files (`src/**`) or the `/api/ai/*` contract. Frontend only under
  `dashboard/src/**`.
- At rest the diff must look BYTE-FOR-BYTE as today — the robot only appears on row hover / the
  active-selection anchor row, exactly like the existing `+`.
- Opening the popup must NOT open the inline comment editor (do not call `setTarget` on a cold
  robot click; keep a separate lightweight anchor).

## Patterns to follow
- Pure-function unit tests: `dashboard/src/use-review-keys.test.ts`, `dashboard/src/suggestion.test.ts`.
- Reuse `currentLineContents(lines, lineMeta, startLine, line)` from `dashboard/src/suggestion.ts`
  for the selected-line text.
- Client: mirror `dashboard/src/review-api.ts` (`asJson` + `fetch` wrappers) for `aiApi`.
- zustand store: `dashboard/src/store.ts` (small `create<...>()` stores).
- Keyboard hook + `isTypingTarget`: `dashboard/src/use-review-keys.ts`.
- Diff gutter + selection (`target`, `beginDrag`, the `w-6` action cell, `renderRow`): `dashboard/src/diff-view.tsx`.
- Existing palette: AI = purple (`ai-suggestion-badge.tsx`), selection = amber, comment `+` = blue-on-hover, surfaces = slate; dark-mode `dark:` variants throughout.

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check / build: `npm --prefix dashboard run build`

## Current state
- `dashboard/src/diff-view.tsx`: `renderRow` builds each row; the `w-6` gutter cell holds the `+`
  button (`onPointerDown={beginDrag}`) shown on hover. Selection state is `target: { startLine?;
  line } | null`; `computeLineMeta(patch)` → `lineMeta`; `lines = patch.split('\n')`.
- `dashboard/src/store.ts`: zustand `useSelection`, `usePanelTab`.
- `dashboard/src/use-review-keys.ts`: `useReviewKeys({...})` adds a window `keydown` handler that
  early-returns when `isTypingTarget(event.target)` (INPUT/TEXTAREA/SELECT); exports pure
  `nextIndex`/`prevIndex`/`nextUnviewedIndex`.
- `dashboard/src/review-api.ts`: `reviewApi` object of `fetch`-based methods via `asJson<T>`.
- Backend (#55–#57): `GET /api/ai/models` → `{ models: {id,name,path}[] }`; `POST /api/ai/ask`
  `{ model, messages }` → `{ reply }` (503 when llama.cpp missing).
- `dashboard/src/index.css`: Tailwind v4 entry; no `--ease-out` token yet.

## Desired end state
- Hovering a commentable diff row shows the `+` AND a robot button in the gutter (purple on
  hover), visually distinct; rest state unchanged. After a drag-select the robot stays visible on
  the anchor row.
- Clicking the robot opens a portaled, `position:fixed` `AiChatPopup` anchored to the row (below,
  flipping above near the viewport bottom, clamped horizontally), scaling in ~170ms; it does not
  open the comment editor.
- The popup sends the selected code as context + the typed question to the default model and
  renders the reply; follow-ups append (ephemeral). Enter sends; Shift+Enter newlines.
- Escape, click-outside, or selecting a different line closes the popup and clears the
  conversation; focus returns to the robot.
- With the popup open, the global review shortcuts (`j/k/n/d/i/v/?`) do nothing.
- `npm test`, `npm run lint`, `npm --prefix dashboard run build` all pass.

## Edge cases and risks
- The diff scroll container is `overflow-auto` — the popup MUST be portaled to `document.body`
  with `position:fixed`, or it gets clipped.
- The virtualized diff (>~200 lines) unmounts the anchor row — capture the anchor rect at open
  time; do not re-read it from a possibly-unmounted row.
- Global shortcuts fire from non-input controls (the Send button) — the guard must suppress them
  whenever the popup is open, not only when a text input is focused.
- Two consecutive user turns are fine (the first user message carries the code context).

## Tasks

- [x] Add the pure code-context builder. Create `dashboard/src/code-context.ts` exporting `buildCodeContext(lines: string[], lineMeta: DiffLineMeta[], target: { startLine?: number; line: number }, padding = 3): { code: string; label: string }`. Use `currentLineContents(lines, lineMeta, startLine, line)` (from `./suggestion`) to get the focus line text; also include up to `padding` context lines immediately before and after the focus range pulled from `lines`/`lineMeta` (by new-file line number), and MARK the focus line(s) so the model knows which lines the question is about (prefix focus lines with `> ` and context lines with `  `). `label` is a human string like `path` is unknown here so use the line range, e.g. `lines 40–48` or `line 42`. Export or import the `DiffLineMeta` type as needed (it is defined in `dashboard/src/diff-view.tsx`; if not exported, export it there and import it here — a type-only change). Write `dashboard/src/code-context.test.ts` following `dashboard/src/suggestion.test.ts`: given a small `patch`'s `lines`+`lineMeta` and a single-line `target`, assert the returned `code` marks the focus line with `> `, includes the surrounding context lines, and `label` reads `line N`; and for a range `target` assert `label` reads `lines A–B` and all focus lines are marked. Run `npm test`.
- [x] Add the pure popup-position calculator. In a new `dashboard/src/popup-position.ts`, export `computeAnchorPosition(anchor: { top: number; bottom: number; left: number }, viewport: { width: number; height: number }, size: { width: number; height: number }, gap = 6): { top: number; left: number; origin: 'top left' | 'bottom left' }`. Default places the popup BELOW the anchor: `top = anchor.bottom + gap`, `left` clamped to `[8, viewport.width - size.width - 8]`, `origin: 'top left'`. If `anchor.bottom + gap + size.height > viewport.height - 8`, place ABOVE: `top = anchor.top - size.height - gap`, same clamped `left`, `origin: 'bottom left'`. Write `dashboard/src/popup-position.test.ts`: (a) with room below → top is `anchor.bottom+gap`, origin `top left`; (b) near the viewport bottom → flips above, origin `bottom left`; (c) an anchor near the right edge → `left` is clamped so `left + size.width <= viewport.width - 8`. Run `npm test`.
- [x] Add the keyboard guard + AI-chat-open store. In `dashboard/src/use-review-keys.ts`, export a pure `shouldHandleReviewKey(target: EventTarget | null, isAiChatOpen: boolean): boolean` that returns `false` when `isAiChatOpen` is true OR `isTypingTarget(target)` is true, else `true`; refactor the window `keydown` handler to early-return unless `shouldHandleReviewKey(event.target, isAiChatOpen)` — take `isAiChatOpen` from a new dep on `ReviewKeysDeps` (default it to `false` for existing callers) OR read it from the store added next. In `dashboard/src/store.ts`, add `export const useAiChatOpen = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))`, and have `useReviewKeys` read `useAiChatOpen((s) => s.open)` to pass into the guard (so no caller change is required). Extend `dashboard/src/use-review-keys.test.ts` with a `describe('shouldHandleReviewKey')`: returns `false` when the popup is open (even for a non-input target like a `div`/`button`), `false` for an INPUT target, and `true` for a plain target when the popup is closed. Run `npm test`.
- [x] Add the AI chat client and the popup component (build-verified UI — no component test; verify with `npm --prefix dashboard run build`). Create `dashboard/src/chat-api.ts` mirroring `dashboard/src/review-api.ts`: `export const aiApi = { listModels: () => fetch('/api/ai/models').then(asJson<{ models: { id: string; name: string; path: string }[] }>), ask: (body: { model: string; messages: { role: 'user' | 'assistant'; content: string }[] }) => fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(asJson<{ reply: string }>) }` (define a local `asJson` like review-api's). Create `dashboard/src/ask-popup.tsx` exporting `AiChatPopup(props: { anchorRect: { top: number; bottom: number; left: number }; scrollContainer: HTMLElement | null; contextCode: string; contextLabel: string; onClose: () => void })`: render via `createPortal(..., document.body)` with `position: fixed`, sized `w-[360px] max-h-[min(60vh,420px)]`, styled `rounded-md border border-slate-200 bg-white shadow-lg z-40 dark:border-slate-700 dark:bg-slate-900`, positioned with `computeAnchorPosition` (measure the popup via a ref/`useLayoutEffect`). SCROLL-FOLLOW (the container is `overflow-auto` and, when virtualized, the anchor row unmounts): capture the initial `anchorRect` and the container's `scrollTop` at open, and on `scrollContainer`'s `scroll` and window `resize`, recompute the base position from `computeAnchorPosition` using an anchor whose `top`/`bottom` are shifted by the scroll delta `-(scrollContainer.scrollTop - openScrollTop)`, then clamp to the viewport — the popup TRACKS the line and stays OPEN (never closes on scroll); if the anchor scrolls off, keep it pinned to the nearest clamped edge. Enter animation `opacity 0→1` + `scale(.96)→1` over 170ms with `transform-origin` from the position result, using `var(--ease-out)` (add `:root { --ease-out: cubic-bezier(0.23, 1, 0.32, 1); }` to `dashboard/src/index.css`); gate all motion behind `prefers-reduced-motion` (opacity only). Header: a `font-mono text-[11px] text-slate-500 dark:text-slate-400` context chip showing `contextLabel`, and a close `✕` (`text-slate-400 hover:text-slate-700 dark:hover:text-slate-200`). Conversation area (`flex-1 overflow-y-auto`): user turns `self-end rounded bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800`, assistant turns `border-l-2 border-purple-300 bg-purple-50/50 px-2 py-1.5 text-sm dark:border-purple-700 dark:bg-purple-950/20`, auto-scroll to bottom. Composer: a growing `<textarea>` (Enter sends, Shift+Enter newlines, `onKeyDown` calls `event.stopPropagation()`), a send button (primary slate, `disabled` while awaiting). On first send resolve the default model with `aiApi.listModels()` (prefer a `name` containing "coder", else the first model's `id`); build `messages` as `[{ role:'user', content: `${contextCode}\n\nAnswer concisely.\nQuestion: ${question}` }, ...priorTurns]`, echo the user turn instantly, show a "Thinking…" indicator, call `aiApi.ask`, then append the assistant turn; on failure append a minimal `Request failed` line. Multi-turn follow-ups append to the same ephemeral `messages`. Escape (an `onKeyDown`/`keydown` listener that `stopPropagation`s and calls `onClose`) and a document `pointerdown` outside the portal node call `onClose`; move focus into the textarea on mount and return focus to the opener on unmount (accept an `onClose` that the caller uses to refocus the robot). Verify with `npm --prefix dashboard run build` (no unit test — no component-test infra).
- [x] Wire the robot affordance into the diff and open the popup (build-verified UI — verify with `npm --prefix dashboard run build`). In `dashboard/src/diff-view.tsx`, inside the `w-6` gutter action cell of `renderRow`, add a small robot button next to the `+`: a 14px inline `<svg>` (simple robot/sparkle, `currentColor`), `className` giving `opacity-0 group-hover:opacity-100` plus visible when this row is the active anchor (`target?.line === newLine`), resting `text-slate-400` and `hover:text-purple-600 dark:hover:text-purple-400`, `title="Ask a local model about this line"`. On click: `event.stopPropagation()`, capture the row's `getBoundingClientRect()` (as `{ top, bottom, left }`) and build `{ code, label } = buildCodeContext(lines, lineMeta, target ?? { line: newLine })`, set local state `aiChat = { anchorRect, code, label }` WITHOUT calling `setTarget` (so the comment editor stays closed), and set the store `useAiChatOpen.setOpen(true)`. Render `{aiChat && <AiChatPopup anchorRect={aiChat.anchorRect} scrollContainer={<the diff's overflow-auto scroll container element>} contextCode={aiChat.code} contextLabel={aiChat.label} onClose={() => { setAiChat(null); useAiChatOpen.getState().setOpen(false); }} />}` once per `DiffView` (not per row) — pass the scroll container the diff already uses for the windowed/virtualized list (via its existing ref's `.current`; if there is no single ref, add one to that `overflow-auto` wrapper, or pass `null` and let the popup fall back to window scroll). Closing on a different-line robot click replaces `aiChat` (clears the prior conversation because the popup remounts — give `AiChatPopup` a `key` tied to the anchor). Verify with `npm --prefix dashboard run build` and confirm at rest the gutter is unchanged (robot hidden until hover/anchor).
- [x] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm --prefix dashboard run build`.
- [x] Fix the rest-state regression in the diff gutter (build-verified UI — verify with `npm --prefix dashboard run build`; NO component test, do NOT add a component-test dependency). In `dashboard/src/diff-view.tsx` the gutter action `<span>` (around line 453) that holds the `+` and robot buttons was widened from `w-6` to `flex w-8 ... gap-0.5` to fit the robot beside the `+`; this reserves 32px instead of 24px and shifts EVERY diff row 8px right AT REST even though both buttons are `opacity-0` until hover, violating the issue's constraint that the idle diff look byte-for-byte as today. Fix: restore the cell to width `w-6` (24px) — that width is the only property that matters for the rest state, since the `+` is `opacity-0` at rest. Add `relative` to that `<span>` and render the robot `<button>` as an absolutely-positioned overlay that reserves NO flow width: add `absolute left-full top-1/2 -translate-y-1/2 z-10 ml-0.5` to the robot button so on hover/anchor it floats just to the RIGHT of the 24px gutter (over the left padding of the adjacent old-line-number `w-12` column) instead of widening the cell. Keep the `+` button exactly as before (normal flow, centered), and keep the robot's existing color/opacity/reveal classes (`text-slate-400 hover:text-purple-600 dark:hover:text-purple-400`, `opacity-0 group-hover:opacity-100`, and the `target?.line === newLine || aiChat?.anchorLine === newLine ? 'opacity-100' : ...` reveal) and its `onClick` unchanged. Do NOT "widen on hover" (that just moves the 8px jump to hover time). Verify: `npm --prefix dashboard run build` is clean AND that `<span>` no longer contains `w-8` (it is `w-6`). Exact robot placement is confirmed visually by a human at PR time.
- [x] Fix the retry-after-failure wrong-question bug and cover it with a pure unit test. In `dashboard/src/ask-popup.tsx`, `sendMessage` caches the first user message in a write-once `contextMessageRef` (set around lines 166-171) and, when `conversationHistory.length === 0`, sends `contextMessageRef.current` (around lines 179-183). If the first send fails anywhere in the `try` (e.g. `resolveModel()`/`listModels()` throwing, or the local server erroring while cold), `conversationHistory` stays `[]`, so a later send with an EDITED question still transmits the frozen first question — the user's new question shows in `turns` but never reaches the model. Fix by extracting a PURE builder and deleting the ref. Create `dashboard/src/chat-messages.ts` exporting `buildOutgoingMessages(conversationHistory: ChatMessage[], contextCode: string, question: string): ChatMessage[]` (import `ChatMessage` from `./chat-api`) that returns, when `conversationHistory.length === 0`, `[{ role: 'user', content: `${contextCode}\n\nAnswer concisely.\nQuestion: ${question}` }]`, else `[...conversationHistory, { role: 'user', content: question }]`. In `ask-popup.tsx`: remove the `contextMessageRef` declaration (around line 49) and its init block (around lines 166-171), and replace the `isFirstMessage`/`newUserMessage`/`messages` construction (around lines 179-183) with `const messages = buildOutgoingMessages(conversationHistory, contextCode, question);` — built from the CURRENT `question` each send. Keep the first-message content format BYTE-IDENTICAL (`${contextCode}\n\nAnswer concisely.\nQuestion: ${question}`) so the multi-turn code-context fix (finding #1) stays intact; leave the rest of `sendMessage` (turn echo, `setConversationHistory([...messages, { role: 'assistant', content: reply }])`, error handling) unchanged. RED first: write `dashboard/src/chat-messages.test.ts` (follow `dashboard/src/code-context.test.ts`) asserting (a) empty history → one message whose content contains BOTH `contextCode` and the `question`; (b) SAME empty history but a DIFFERENT `question` (the retry case) → content uses the NEW question and still contains `contextCode`; (c) non-empty history → `[...history, { role:'user', content: question }]` with NO `contextCode` re-added. Confirm the test fails before the change and passes after. Run `npm test`, `npm run lint`, `npm --prefix dashboard run build`.
