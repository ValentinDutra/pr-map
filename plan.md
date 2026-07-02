# #60 — Model dropdown with persisted choice + server swap

## Goal
Let a reviewer choose which local model answers in the ask popup via a native `<select>` in the
popup header, persist that choice to `localStorage` so it survives popup remounts and page
reloads, and route the chosen model to `POST /api/ai/ask` (which already swaps the backend
llama-server). An empty or failed model list degrades gracefully — the popup keeps working on the
existing default-model resolution, no crash.

## Approach
Match the repo's #59 convention: extract the one piece of real logic — deciding which model to
pre-select given the fetched list and the saved id — into a pure, unit-tested
`dashboard/src/model-select.ts` (`resolveInitialModel`), and implement the React glue (fetching
the list, the `<select>`, localStorage read/write, routing the choice to `ask`) as thin edits to
`dashboard/src/ask-popup.tsx` verified by the dashboard build. There is NO React component-test
infra and this slice does not add one; only the extracted pure function is unit-tested.

## Constraints
- Do NOT add `@testing-library/react`, jsdom, or any component-test dependency. Unit-test only
  the extracted pure function; the popup edits are build-verified.
- Do NOT build a custom (non-native) dropdown — use a native `<select>` (zero focus/z-index
  risk). Styling stays minimal/slate.
- Do NOT add cold-start indicators or the styled amber/red error states — those are #61. Keep the
  current bare `Request failed` behavior untouched.
- Do NOT change backend files (`src/**`) or the `/api/ai/*` contract. Frontend only under
  `dashboard/src/**`.
- Preserve the existing default-model behavior as the fallback: when no model is selected/available
  the popup must still resolve a default (prefer a name containing "coder", else the first) exactly
  as today, so a reviewer who never touches the dropdown sees no change.
- Keep the popup's existing structure (portal, positioning, scroll-follow, multi-turn, keyboard
  guard) unchanged — this slice only adds the header `<select>` + model state.

## Patterns to follow
- Pure-function unit tests: `dashboard/src/code-context.test.ts`, `dashboard/src/chat-messages.test.ts`.
- Existing model default-resolution to mirror: `resolveModel` in `dashboard/src/ask-popup.tsx`
  (lines 149-157 — prefer `name` containing "coder", else `models[0]`).
- Shared model shape: `ModelInfo` in `dashboard/src/types.ts` (line 157: `{ id; name; path }`);
  `aiApi.listModels()` in `dashboard/src/chat-api.ts` returns `{ models }` of that shape.
- Native-input handling for shortcuts: `isTypingTarget` already treats `SELECT` as a typing
  target, and the open popup already suppresses all review shortcuts via `useAiChatOpen` — so no
  keyboard-guard change is needed.

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check / build: `npm --prefix dashboard run build`

## Current state
- `dashboard/src/ask-popup.tsx`: `AiChatPopup` has state `modelId` (line 51, `string | null`);
  `resolveModel()` (149-157) lazily fetches `aiApi.listModels()`, picks a "coder" model else the
  first, caches it in `modelId`, and throws if none. `sendMessage` (159-184) calls
  `const model = await resolveModel()` then `aiApi.ask({ model, messages })`. The header (220-232)
  is `flex items-center justify-between` with a `font-mono text-[11px]` context-label chip (left)
  and a close ✕ button (right). The popup is portaled/`fixed`, remounts per anchor (keyed), so
  component state resets each time it opens.
- `dashboard/src/chat-api.ts`: `aiApi.listModels(): Promise<{ models: AiModel[] }>` and
  `aiApi.ask({ model, messages }): Promise<{ reply }>`; `AiModel = { id; name; path }`.
- `dashboard/src/types.ts`: `ModelInfo = { id: string; name: string; path: string }` (line 157).
- `dashboard/src/use-review-keys.ts`: `isTypingTarget` returns true for INPUT/TEXTAREA/SELECT.

## Desired end state
- The popup header shows a native `<select>` listing every model from `aiApi.listModels()`, to the
  left of the close ✕, alongside the context chip.
- Opening the popup pre-selects the model saved in `localStorage` (if still in the list), else the
  "coder"-preferred default, else the first model.
- Changing the `<select>` persists the id to `localStorage`; a later open or a page reload
  pre-selects it.
- Asking routes the selected `{ model }` to `/api/ai/ask` (observably answered by the chosen model).
- An empty or failed model list renders no `<select>` and does not crash; `sendMessage` falls back
  to the existing default resolution.

## Edge cases and risks
- The popup remounts per anchor, so model state resets on every open — persistence MUST come from
  `localStorage` (read on mount), not component state.
- A saved id that is no longer in the returned list must NOT be selected — fall back to the default.
- `aiApi.listModels()` can reject (backend/llama down) — the mount fetch must swallow errors
  (empty list, no crash) and `sendMessage` must still resolve a default via the existing path.
- The `<select>` must not trigger global review shortcuts — already handled (`isTypingTarget`
  covers SELECT and the open popup suppresses shortcuts); do not regress this.
- No streaming/no new endpoints; backend swap latency is the ask-endpoint's concern, not this slice.

## Tasks

- [x] Create the pure initial-model resolver. New file `dashboard/src/model-select.ts` exporting `export const MODEL_STORAGE_KEY = 'pr-map-ai-model';` and `export function resolveInitialModel(models: ModelInfo[], savedId: string | null): string` (import `ModelInfo` from `./types`). Return: `savedId` when it is non-empty AND some `models[i].id === savedId`; else the id of the first model whose `name.toLowerCase()` includes `'coder'`; else `models[0]?.id`; else `''` (empty string = no model). This mirrors the existing `resolveModel` default (ask-popup.tsx:152-153) plus the saved-preference. Write `dashboard/src/model-select.test.ts` following `dashboard/src/chat-messages.test.ts`: assert (a) a `savedId` present in the list is returned; (b) a `savedId` NOT in the list falls back to the coder-named model's id; (c) with no coder model, the first model's id is returned; (d) an empty list returns `''`; (e) a `null` savedId with a coder model returns the coder id. Run `npm test`.

- [x] Now that `resolveInitialModel` exists, wire the model dropdown into the popup (build-verified UI — verify with `npm --prefix dashboard run build`; NO component test, do NOT add a component-test dependency). In `dashboard/src/ask-popup.tsx`: import `{ MODEL_STORAGE_KEY, resolveInitialModel }` from `./model-select` and `type ModelInfo` from `./types`. Add state `const [models, setModels] = useState<ModelInfo[]>([]);`. On mount, fetch the list and initialize the selection with a `useEffect(() => { aiApi.listModels().then(({ models }) => { setModels(models); setModelId((cur) => cur ?? (resolveInitialModel(models, localStorage.getItem(MODEL_STORAGE_KEY)) || null)); }).catch(() => {}); }, [])` — the `.catch(() => {})` makes a failed list a no-op (empty models, no crash). In the header (the `flex items-center justify-between` div at ~line 220), wrap the existing context-label chip together with a new native `<select>` in a left-side `<div className="flex items-center gap-2 min-w-0">` (keep the close ✕ button on the right, unchanged). Render the `<select>` ONLY when `models.length > 0`: `<select value={modelId ?? ''} onChange={(e) => { setModelId(e.target.value); localStorage.setItem(MODEL_STORAGE_KEY, e.target.value); }} className="max-w-[150px] truncate rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{models.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}</select>`. In `sendMessage`, change `const model = await resolveModel();` to `const model = modelId || (await resolveModel());` so a chosen model is used and the existing default resolution remains the fallback when none is selected. Do NOT remove `resolveModel` (it is the fallback) and do NOT change the popup's portal/positioning/scroll-follow/multi-turn/keyboard-guard code. Verify with `npm --prefix dashboard run build` and confirm at rest the popup is unchanged when there are 0 models (no `<select>` rendered).

- [x] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm --prefix dashboard run build`.
