# pr-map v3 — Symbol-level filtering, GitHub-faithful comments, theming

## Goal
Evolve pr-map so the graph shows only neighbors genuinely affected by a PR (decided
deterministically at the symbol level), the review comment model mirrors GitHub exactly
(line incl. multi-line range, file, and PR scopes, with Approve/Request changes/Comment
verdicts plus standalone conversation comments), and the dashboard has an intuitive layout
with a dark/light theme that follows the OS. Design: `docs/superpowers/specs/2026-06-17-pr-map-v3-design.md`.

## Approach
Keep the existing architecture: a deterministic static graph (built by `src/cli.ts` →
`src/build-graph.ts`) plus LLM enrichment that ONLY explains connections — the LLM never
decides graph membership. Neighbor filtering is computed statically from each changed file's
diff: extract the exported symbols the diff touched, then keep a neighbor only if the changed
lines reference a symbol crossing the edge to it. The comment model extends the existing
pending-review store (`src/review-endpoints.ts`) and `gh` client (`src/gh-client.ts`) to carry
the three GitHub scopes. The dashboard (React 19 + Vite + @xyflow/react + Tailwind v4) gains a
theme provider and a tabbed review panel.

## Constraints
- Do NOT let the LLM/enrichment decide which nodes or edges exist; membership stays static and
  reproducible. Enrichment (`src/merge-enrichment.ts`) keeps its current role (summary, why,
  insights, `origin:"llm"` semantic edges) — do not change it.
- Do NOT add symbol support beyond JS/TS and Python (match `src/import-rules.ts` coverage).
- Do NOT change plugin packaging, the `pr-file-analyst` agent, or the SessionEnd hook.
- Do NOT build GitHub "suggestion" blocks, reactions, or thread-resolution UI.
- Symbol extraction must FAIL OPEN: if extraction throws or returns an empty set for a file,
  keep that file's neighbors rather than hiding on uncertainty.
- Follow CLAUDE.md: Result pattern for errors, Dependency Injection, no abbreviated variable
  names, self-documenting code, minimum tests for maximum value.
- Relative imports use NodeNext `.js` extensions (e.g. `import { ok } from './result.js'`).

## Patterns to follow
- Pure module + DI: follow `src/import-rules.ts` (exported pure functions, `node:path` posix).
- Graph building + DI providers (`GitGrep`, `ReadContent`): follow `src/build-graph.ts`.
- gh client methods (injected `CommandExecutor`, Result return, Retry): follow `src/gh-client.ts`.
- Review store/router (serialized store, `wrap()` async handlers, Result): follow `src/review-endpoints.ts`.
- Pure-function unit tests: follow `src/import-rules.test.ts`. Graph tests: `src/build-graph.test.ts`.
  gh tests: `src/gh-client.test.ts`. Endpoint tests: `src/review-endpoints.test.ts`.
- Dashboard components: follow `dashboard/src/detail-panel.tsx`, `dashboard/src/diff-view.tsx`,
  `dashboard/src/review-controls.tsx`, `dashboard/src/review-api.ts`, `dashboard/src/store.ts`.
- Types mirror: `src/types.ts` is mirrored by `dashboard/src/types.ts` — keep them in sync.

## Verification commands
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Tests: `npm test`
- Dashboard build: `npm --prefix dashboard run build`
- Plugin bundle: `npm run build:plugin`

## Current state
- `src/build-graph.ts` adds an incoming edge for EVERY file that imports a changed file
  (`addIncomingEdges` via `git grep`), and an outgoing edge for every import the changed file
  makes (`addOutgoingEdges`). No symbol-level filtering — all importers become neighbor nodes.
- `src/types.ts`: `PendingComment { id, path, line?, side?, body, inReplyTo? }`,
  `ReviewState { prNumber, comments, generalBody? }`. `PrGraph { meta, nodes, edges, generatedAt }`.
- `src/review-endpoints.ts`: `addComment` (line-presence = inline vs general), `buildSubmission`
  folds general comments into the review body, `submitReview`, `/comment`, `/pending`,
  `/comment/:id`, `/reply`, `/submit`. `gh` review via `src/gh-client.ts` `createReview`/`replyToComment`.
- Dashboard: `App.tsx` fetches `/api/graph`; `graph-view.tsx` renders nodes/edges;
  `diff-view.tsx` has a clickable line gutter for inline comments; `detail-panel.tsx` shows diff +
  insights + a comment composer; `review-controls.tsx` holds the verdict submit. No theme, no tabs,
  no file/PR-scope distinction, no multi-line ranges, no conversation comments.

## Desired end state
- Building the graph for a debt-only change keeps `api/debts/*` and `api/recurring-debts/*` (they
  call changed debt functions) and drops `api/accounts`, `api/categories`, `api/records`,
  `api/settings`, `api/wallet`; the printed CLI JSON reports a non-zero hidden-neighbor count.
- A reviewer can, from the dashboard: comment on a line or a multi-line range; comment on a whole
  file; write a PR-level review summary; submit a verdict (Approve/Request changes/Comment); and
  post a standalone conversation comment that appears immediately. Each posts to GitHub via `gh`.
- The dashboard opens in the OS theme, with a header toggle that persists the choice; the review
  panel has Diff/Insights/Conversation tabs and a "Finish review" tray with a pending count.

## Edge cases and risks
- A changed file with no detectable changed symbols (pure internal/whitespace change): fail-open —
  keep its neighbors, do not silently hide them.
- `import * as ns` namespace imports: a dependent is affected only if it uses `ns.<changedSymbol>`;
  check usage, not just the import line.
- Renamed files already use `previousPath`; symbol filtering must not regress rename handling in
  `addIncomingEdges`.
- The GitHub bulk reviews endpoint may not accept `subject_type: file` in `comments[]`; file
  comments may need `POST /repos/{owner}/{repo}/pulls/{n}/comments` with `commit_id`. Resolve which
  endpoint works in the gh-client task and use it; this does not change the data model.
- A reviewer cannot Approve their own PR (GitHub rejects it) — existing behavior, keep the guard.
- Tailwind v4 dark mode: use a class strategy on the root element so the toggle works without a reload.

## Tasks

- [x] Create `src/changed-symbols.ts` exporting a pure function `extractChangedSymbols(input: { patch: string; headContent?: string; language: string; status?: string }): Set<string>` that returns the exported symbol names a diff touched. Parse the unified diff: from each hunk header `@@ -a,b +c,d @@ <context>` pull the declared identifier in `<context>` (e.g. `export async function updateDebt` yields `updateDebt`); from added/removed lines pull exported declarations (`export function|const|class|type|interface NAME`, `export default`, `export { A, B }`; Python `def NAME` / `class NAME`). When `status === 'added'`, parse all exports from `headContent`. Cover JS/TS and Python only (branch on `language` like `src/import-rules.ts`). No new dependencies. Write `src/changed-symbols.test.ts` following `src/import-rules.test.ts`: a TS patch whose hunk header names a function, a TS patch adding `export const`, an `added` file returning all its exports, and a Python `def`/`class` patch. Run `npm test` and `npm run typecheck`.

- [x] Now that `extractChangedSymbols` exists, apply symbol-level neighbor filtering in `src/build-graph.ts`. Compute `changedSymbols` per PR file from its `patch`/content and thread it through `addIncomingEdges` and `addOutgoingEdges` (inject `extractChangedSymbols` as a dependency, matching the existing `GitGrep`/`ReadContent` injection style). Incoming: keep a dependent only if it imports/uses a symbol in the changed file's `changedSymbols` (handle `import { x }`, `import * as ns` + `ns.x` usage, default import) — reuse `src/import-rules.ts` resolution. Outgoing: keep a dependency only if a changed (added/removed) line of the changed file references a symbol imported from it. Drop neighbor nodes (`inPr:false`) left with zero active edges. FAIL OPEN per the Constraints. Add a `hiddenNeighborCount: number` field to `PrGraph` and an `affectedSymbol?: string` field to `GraphEdge` in `src/types.ts` (record the symbol that activated each kept edge so the dashboard can label edges later), and include `hiddenNeighborCount` in the `src/cli.ts` printed JSON. Wire the provider in `src/cli.ts`. Extend `src/build-graph.test.ts`: a changed file exporting `{X,Y}` keeps an importer using `X`, drops one using only `Z`, and keeps an outgoing dependency referenced on a changed line. Run `npm test`, `npm run typecheck`, `npm run lint`.

- [x] Extend `src/gh-client.ts` for the three comment scopes. Update the `ReviewSubmission`/comment types so review comments may carry `startLine`/`startSide` (multi-line range) and a `subjectType: 'line' | 'file'`; map them into the `gh api .../pulls/{n}/reviews` payload (`start_line`, `start_side`, and file comments via `subject_type: file`, falling back to `POST .../pulls/{n}/comments` with `commit_id` if the bulk endpoint rejects file subjects — verify with `gh api` against a real PR). Add `getHeadSha(prNumber): Promise<Result<string, GhError>>` (`gh api .../pulls/{n} --jq .head.sha`) and `createConversationComment(prNumber, body): Promise<Result<string, GhError>>` (`gh api repos/{owner}/{repo}/issues/{n}/comments -f body=...`). Keep the injected `CommandExecutor`, Result returns, and Retry pattern. Extend `src/gh-client.test.ts` (mock executor) to assert the reviews payload includes range/file fields and that `createConversationComment` calls the issues endpoint. Run `npm test`, `npm run typecheck`.

- [x] Now that the gh client supports ranges/file/conversation, update the comment model. In `src/types.ts`: replace the line-presence heuristic with `PendingComment { id; scope: 'line' | 'file'; path: string; line?; startLine?; side?; startSide?; body; inReplyTo? }` and add `summaryBody?: string` to `ReviewState` (remove `generalBody`; migrate its role to `summaryBody`). In `src/review-endpoints.ts`: `addComment` accepts `scope` + range fields and validates per scope (line needs `path`+`line`; file needs `path`; if `startLine` set, require `startLine <= line`); `buildSubmission` maps `comments[]` (line + file, with range/subjectType) to the gh submission and uses `summaryBody` for the review body; add a `POST /conversation` route calling `createConversationComment` (immediate, Result-guarded via `wrap()`); add a `PUT /summary` route that persists `summaryBody` via the store. Mirror the type changes in `dashboard/src/types.ts`. Update `src/review-endpoints.test.ts` for the three scopes and the conversation route. Run `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] Add theming infrastructure to the dashboard. Create `dashboard/src/theme.ts` (a small zustand store like `dashboard/src/store.ts`) that initializes from `window.matchMedia('(prefers-color-scheme: dark)')`, persists the choice to `localStorage`, and toggles a `dark` class on `document.documentElement`. Enable Tailwind v4 class-based dark mode in `dashboard/src/index.css`, and add a theme toggle control in the header rendered by `dashboard/src/App.tsx`. Verify with `npm --prefix dashboard run build`.

- [ ] Now that the theme store and `dark` class toggle exist, add `dark:` Tailwind variants to the graph-side components so light and dark both read cleanly: `dashboard/src/graph-view.tsx`, `dashboard/src/file-node.tsx`, `dashboard/src/sidebar.tsx`. Verify with `npm --prefix dashboard run build`.

- [ ] Now that the theme store and `dark` class toggle exist, add `dark:` Tailwind variants to the review-panel components so light and dark both read cleanly: `dashboard/src/detail-panel.tsx`, `dashboard/src/diff-view.tsx`, `dashboard/src/review-controls.tsx`. Verify with `npm --prefix dashboard run build`.

- [ ] Now that theming exists, add the review-panel tab bar. In `dashboard/src/detail-panel.tsx` add a tab bar with Diff, Insights, and Conversation tabs and render the existing diff and insights content under the first two tabs; track the active tab in `dashboard/src/store.ts`. Verify with `npm --prefix dashboard run build`.

- [ ] Now that the tabbed panel exists, add the "Finish review" tray. Move the verdict submit out of `dashboard/src/review-controls.tsx` into a tray opened from the header in `dashboard/src/App.tsx`: a summary textarea plus Approve/Request changes/Comment radios and a submit button, showing a pending-comment count from `/api/review/pending`. Add `setSummary(body)` to `dashboard/src/review-api.ts` (calling the `PUT /summary` route) and have `submit(event)` drive the review body from `summaryBody`. Verify with `npm --prefix dashboard run build`.

- [ ] Now that the panel is tabbed, make `dashboard/src/diff-view.tsx` post GitHub-style comments. On line hover show a "+" affordance to comment on that line; support selecting a multi-line range (shift-click from a first-clicked line) producing `startLine`/`line` with `side`/`startSide`; add a "Comment on file" button in the diff header producing a `scope:'file'` comment. Update the existing `addComment` in `dashboard/src/review-api.ts` to the new signature `addComment({ scope, path, line?, startLine?, side?, startSide?, body })` and wire all three affordances to it. Render the file's pending comments as inline threads. Verify with `npm --prefix dashboard run build`.

- [ ] Now that line/file comments work, add the Conversation tab content in `dashboard/src/detail-panel.tsx`: list and add standalone PR comments via a new `dashboard/src/review-api.ts` `addConversationComment(body)` hitting `POST /api/review/conversation` (posts immediately). Verify with `npm --prefix dashboard run build`.

- [ ] Now that the graph produces an `affectedSymbol` per kept edge and a `hiddenNeighborCount` (from the build-graph filtering task), surface them in `dashboard/src/graph-view.tsx`: label each edge with its `affectedSymbol` when present (fall back to `kind`), and show the `hiddenNeighborCount` as a passive note ("N importers with no affected symbols, hidden"). Ensure `dashboard/src/types.ts` mirrors the final `PrGraph` and comment types. Verify with `npm --prefix dashboard run build`.

- [ ] Run full verification and refresh the committed plugin bundle: `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix dashboard run build`, then `npm run build:plugin` (regenerates `pr-map-plugin/dist/*` and `pr-map-plugin/dashboard-dist/`). Fix any failures. Then run a bundled end-to-end smoke against a checked-out PR: `node pr-map-plugin/dist/cli.js <ref> "$(pwd)"` and confirm the printed JSON shows a non-zero `hiddenNeighborCount` and fewer nodes than before. Commit the refreshed bundle.
