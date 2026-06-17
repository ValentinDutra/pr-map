# pr-map — PR mind map and reviewer

## Goal
Build `pr-map`, a Claude Code plugin invoked as `/pr-map <pr-ref>` that turns a GitHub
Pull Request into an interactive web mind map and lets the user review it from the
browser. Changed files are nodes; edges show how files connect (imports/references)
and why; one-hop neighbors (unchanged files that talk to the changed ones) are included
so the blast radius is visible. From the dashboard the user writes inline and general
comments and submits a review (approve / request changes / comment) to GitHub through
the already-authenticated `gh` CLI. The point is to make "which file talks to which and
why" obvious before reviewing.

## Approach
Step-by-step pipeline (the engine the user described):
1. Deterministic Node scripts fetch the PR via `gh` and turn changed files into nodes.
2. A lightweight regex import-scanner (NOT full parsers) finds edges and pulls in
   one-hop neighbors. Outgoing edges = what a changed file imports; incoming edges =
   who imports a changed file (found with `git grep`). Files with no relation stay isolated.
3. At runtime the Claude Code agent (driven by the skill prompt) enriches the graph:
   writes the plain-language "why" for each node and edge and may add semantic edges.
   Every edge carries an `origin` (`static` | `llm`) and a `confidence`, so LLM-inferred
   links are never confused with certain ones.
The dashboard is a local web app (React + Vite + React Flow + dagre + Tailwind) served by
a small Node/Express backend whose write endpoints shell out to `gh`. This mirrors the
proven core of Understand-Anything (MIT) scoped down to PRs; we study its dashboard for
patterns but do not fork it. The LLM step is the Claude Code agent, so there is no API key
and no separate billing. The graph builder and dashboard are kept as standalone Node
modules so a future standalone CLI is a cheap wrapper.

## Constraints
- Do NOT support providers other than GitHub (no GitLab/Bitbucket) in v1.
- Do NOT call the Anthropic API or manage API keys — the "LLM step" is the Claude Code
  agent at runtime, driven by the skill prompt.
- Do NOT handle auth/tokens — rely on the user's already-authenticated `gh` CLI.
- Do NOT add node granularity below file level (no function/class nodes). Nodes = files.
- Do NOT write language parsers beyond regex import-rules for JS/TS + Python in v1.
- Do NOT rebuild the reference repo's extra features: whole-codebase analysis, business/
  domain views, knowledge-base mode, themes, i18n, persona-adaptive UI, guided tours,
  community clustering, multiple layout engines.
- Do NOT auto-submit a review. Submitting posts to GitHub and must be an explicit user action.
- Do NOT write tests for pure UI components. Test logic units only (gh-client, edge
  detection, review endpoints) with injected fakes/fixtures.
- Do NOT add Claude attribution to commits or PRs.

## Patterns to follow
- Error handling: use the Result pattern — return `Result<T, E>`, never throw for
  expected failures. The `Result` type and its `ok`/`err` constructors are created by the
  contracts task (`src/result.ts`); every task after it imports from there.
- Transient failures: use the Retry pattern via `retry(...)` in `src/retry.ts` (created by
  the contracts task), applied inside the gh executor.
- Dependency Injection: inject the command executor into the gh-client; inject the
  gh-client into the fetcher and the review endpoints; inject `gitGrep` into the
  incoming-edge builder. Tests pass fakes.
- React Flow graph rendering: read `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
  in `github.com/Egonex-AI/Understand-Anything` (fetch via `gh api repos/Egonex-AI/Understand-Anything/contents/<path>`)
  and replicate the structure.
- Diff/code rendering: read that repo's `understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx`
  for the prism-react-renderer pattern.
- Naming: no abbreviations (`comparisonPeriod`, not `cp`; `changedFiles`, not `cf`).
- Tests: `vitest`, fixtures under `src/__fixtures__/`, fakes injected via DI.

## Verification commands
- Tests: `npx vitest run`
- Lint: `npx eslint .`
- Type check: `npx tsc --noEmit`
- Dashboard build: `npm --prefix dashboard run build`

## Current state
Empty private repo `pr-map` (github.com/ValentinDutra) containing only this `plan.md`,
`README.md`, `learnings.txt`, and `.gitignore`. No code yet. Tooling available: node
v25.2.1, gh 2.88.1 (authenticated, `repo` scope, ssh), python3 3.14.5, ripgrep, git grep.
Reference patterns (study, do not fork): `github.com/Egonex-AI/Understand-Anything` (MIT),
confirmed to contain `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
and `.../CodeViewer.tsx`.

## Desired end state
Running `/pr-map <pr-ref>` from inside a local checkout of a GitHub repo:
- checks `gh` is authenticated and resolves the PR (number, URL, or current branch),
- writes `.pr-map/<owner>-<repo>-<number>/graph.json` containing PR-file nodes + one-hop
  neighbor nodes, static edges (outgoing + incoming) and LLM-added edges, each edge with
  `origin` and `confidence`, and a `why`/`summary` filled by the agent,
- opens a browser dashboard: an interactive graph (PR nodes vs neighbor nodes styled
  differently, edge origin/confidence visible), a click-to-open side panel per node with
  the file summary and its diff, and search,
- lets the user add inline comments (file + line) and general comments that batch into a
  local pending review, then submit with a verdict (APPROVE / REQUEST_CHANGES / COMMENT)
  and reply to existing review threads — all posted to GitHub via `gh`.

## Data contracts (defined once, in `src/types.ts`)
- `GraphNode`: `id` (repo-relative path), `path`, `language` (by extension), `inPr`
  (false = one-hop neighbor), `status?` (added|modified|deleted|renamed), `additions?`,
  `deletions?`, `summary?` (agent-filled).
- `GraphEdge`: `id`, `source` (node id), `target` (node id), `kind`
  (import|reference|semantic), `direction` (outgoing|incoming), `origin` (static|llm),
  `confidence` (0..1), `why?` (agent-filled). Note: `source`/`target` are node ids
  (React Flow convention); `origin` is the static-vs-llm provenance.
- `PrMeta`: `owner`, `repo`, `number`, `title`, `description`, `author`, `baseRef`, `headRef`.
- `PrGraph`: `meta: PrMeta`, `nodes: GraphNode[]`, `edges: GraphEdge[]`, `generatedAt`.
- `PendingComment`: `id`, `path`, `line?` (absent = file-level/general), `side?`
  (LEFT|RIGHT), `body`, `inReplyTo?` (GitHub comment id for replies).
- `ReviewState`: `prNumber`, `comments: PendingComment[]`, `generalBody?`.

## Edge cases and risks
- `gh` not authenticated or PR not found: fail fast with a clear message; do not write a
  partial graph.
- Path-alias / monorepo imports (tsconfig `paths`, bare specifiers) the regex resolver
  cannot resolve: emit no static edge rather than guessing; the agent may add a low-
  confidence `llm` edge. Bare/node_modules specifiers are ignored, not turned into nodes.
- Binary, generated, or very large files: skip import scanning; still show as nodes.
- PRs with many files: the graph may get large. v1 renders all of them; if a cap is ever
  added, `log` what was dropped — never silently truncate.
- Incoming-edge scan uses `git grep` over tracked files at the PR head; PR-added files are
  tracked once the branch is checked out, so the tool must operate on the checked-out PR.
- Renamed files: handle `status: renamed` (old path -> new path) so edges resolve.
- LLM hallucination: never merge `llm` edges into `static` ones; the UI shows `origin`
  and `confidence` distinctly. The agent is instructed to flag uncertainty.
- Submitting a review posts to GitHub and is hard to undo: it is always an explicit user
  click; the tool never submits automatically.
- Dashboard port already in use: pick a default port and fall back to the next free one.

## Tasks

- [x] Set up the project tooling. Create `package.json` (deps `express`, `open`; devDeps `typescript`, `tsx`, `vitest`, `eslint`, `@types/node`, `@types/express`), `tsconfig.json` (strict; `module`/`moduleResolution` NodeNext; `noEmit`; `include: ["src"]`), `eslint.config.mjs` (flat config for TypeScript), and a placeholder `src/index.ts` exporting a single constant so `tsc` and `eslint` have an input. Add npm scripts: `typecheck` = `tsc --noEmit`, `lint` = `eslint .`, `test` = `vitest run`. Verify: `npx tsc --noEmit` and `npx eslint .` both exit 0.

- [x] Now that the tooling exists, define the data contracts and shared helpers. Create `src/types.ts` with every type in the "Data contracts" section (`GraphNode`, `GraphEdge`, `PrMeta`, `PrGraph`, `PendingComment`, `ReviewState`). Create `src/result.ts` (a `Result<T, E>` discriminated union with `ok(value)` / `err(error)` constructors and an `isOk` type guard). Create `src/retry.ts` exporting `retry(operation, { attempts, delayMs })` that calls a `Result`-returning async `operation` and retries while it returns `err`, up to `attempts`, with `delayMs` between tries, returning the last `Result`. Write `src/retry.test.ts` (vitest): an operation that errs twice then oks succeeds within 3 attempts; one that always errs returns `err` after exactly `attempts` calls. `result.ts` is type-only — no test. Verify: `npx vitest run src/retry.test.ts` and `npx tsc --noEmit`.

- [x] Now that the contracts and Result/Retry helpers exist, create `src/gh-client.ts`: an injectable client over the `gh` CLI. Define `type CommandExecutor = (args: string[], stdin?: string) => Promise<Result<string, GhError>>` and `createGhClient(execute: CommandExecutor)` returning `getPrMetadata`, `listChangedFiles`, `getDiff`, `getFileContent`, `createReview`, `replyToComment` — each returning a `Result`, wrapping `execute` with `retry` from `src/retry.ts`. Add `createDefaultExecutor()` in the same file: a thin `spawn('gh', args)` wrapper returning `Result`. Follow the Result/Retry/DI patterns above. Write `src/gh-client.test.ts` with a fake `CommandExecutor` returning canned JSON: assert each method builds the right `gh` args and parses output, and that a fail-then-succeed executor triggers a retry. Verify: `npx vitest run src/gh-client.test.ts`.

- [x] Now that `gh-client` exists, create `src/fetch-pr.ts`: `fetchPr(ghClient, ref): Promise<Result<RawPr, FetchError>>` resolving the PR ref (number, URL, or current branch) and assembling `RawPr` = PR metadata + changed files (path, status, additions, deletions) + per-file diff + full content at the PR head, using the injected `ghClient`. Define the `RawPr` type at the top of this file. Add `writeRaw(rawPr, workingDir)` saving `.pr-map/<owner>-<repo>-<number>/raw.json`. Inject `ghClient` (do not construct it inside). Write `src/fetch-pr.test.ts` with a fake `ghClient`: assert `RawPr` assembly and the working-dir key. Verify: `npx vitest run src/fetch-pr.test.ts`.

- [x] Now that the `RawPr` type exists, create `src/build-graph.ts` with node building only: `buildNodes(rawPr): GraphNode[]` mapping each changed file to a `GraphNode` (`id`/`path` = repo-relative path, `language` from a small extension-to-language map, `inPr: true`, `status`, `additions`, `deletions`, empty `summary`); renamed files use the new path as `id`. Write `src/build-graph.test.ts` asserting language detection and field mapping over a small fixture `RawPr`. Verify: `npx vitest run src/build-graph.test.ts`.

- [x] Now that `buildNodes` exists, create `src/import-rules.ts` and add outgoing-edge detection to `src/build-graph.ts`. `import-rules.ts` exports `ImportRule` entries for JS/TS (`import ... from '...'`, `require('...')`, `export ... from '...'`) and Python (`import a.b`, `from a.b import c`), each with `resolve(specifier, fromPath, repoFiles)` returning candidate repo-relative paths (relative specifiers resolved against the importing file's dir, trying known extensions and `index.*` / `__init__.py`; bare/node_modules specifiers return none). Add `addOutgoingEdges(nodes, rawPr, repoFiles)` to `build-graph.ts`: scan each PR node's content for imports, resolve them, create a `GraphEdge` (`kind: import`, `direction: outgoing`, `origin: static`, `confidence: 1`) to the target, and if the target is a repo file not yet a node add it as a neighbor (`inPr: false`). Add fixtures under `src/__fixtures__/` and extend `build-graph.test.ts` for JS/TS + Python resolution and neighbor creation. Verify: `npx vitest run src/build-graph.test.ts`.

- [x] Now that outgoing edges and `import-rules` exist, add incoming-edge (blast-radius) detection to `src/build-graph.ts`: `addIncomingEdges(nodes, prFilePaths, repoFiles, gitGrep)` where `gitGrep(pattern) => string[]` is injected (the default shells out to `git grep -l`). For each PR file derive its importable specifier forms (relative path stems, dotted module path), call `gitGrep` for referencing files, confirm each candidate with the `import-rules` resolver to drop false positives, then add confirmed importers as neighbors (`inPr: false`) and edges (`kind: import`, `direction: incoming`, `origin: static`, `confidence: 1`) from importer to PR file. Inject `gitGrep` (do not call git inside the core function). Extend `build-graph.test.ts` with a fake `gitGrep`: assert importers become neighbors with incoming edges and non-confirming matches are dropped. Verify: `npx vitest run src/build-graph.test.ts`.

- [x] Now that the node, outgoing-edge, and incoming-edge builders exist, add assembly and persistence to `src/build-graph.ts`: `assembleGraph(rawPr, repoFiles, gitGrep, generatedAt): PrGraph` runs `buildNodes` -> `addOutgoingEdges` -> `addIncomingEdges`, dedupes nodes/edges by `id`, sets `meta` from `rawPr`, and accepts `generatedAt` as an argument (do not call `Date.now()` inside). Add `writeGraph(graph, workingDir)` writing `.pr-map/<owner>-<repo>-<number>/graph.json`. Extend `build-graph.test.ts` to assert a full deduped `PrGraph` from a fixture. Verify: `npx vitest run src/build-graph.test.ts`.

- [x] Scaffold the dashboard and render the graph. Create `dashboard/` as a Vite + React 19 + TypeScript app (deps `@xyflow/react`, `@dagrejs/dagre`, `@tailwindcss/vite`, `tailwindcss`) with a checked-in fixture `dashboard/src/__fixtures__/graph.json` shaped as `PrGraph`. Lay the graph out with dagre and render with React Flow: PR nodes vs neighbor nodes (`inPr:false`) styled differently (neighbors dimmed/dashed); edges show `kind`, with `origin` distinguishing style (`static` solid, `llm` dashed) and `confidence` in the tooltip. Add zoom/pan and a search box highlighting matching nodes. Read the reference repo's `GraphView.tsx` (path in "Patterns to follow") via `gh api` first and replicate its structure. Verify: `npm --prefix dashboard run build` succeeds.

- [ ] Now that the dashboard renders the graph, add the node detail + diff side panel. Clicking a node opens a panel showing the path, `summary`, the connected edges with their `why` / `origin` / `confidence`, and the file's unified diff rendered with `prism-react-renderer` (read the reference repo's `CodeViewer.tsx`, path in "Patterns to follow"). Neighbor nodes show relationships only (no diff). Use `zustand` for selected-node state. Verify: `npm --prefix dashboard run build` succeeds.

- [ ] Now that `graph.json` (assembly task) and the built dashboard exist, create `src/server.ts`: a Node/Express server serving `dashboard/dist` and exposing `GET /api/graph` (reads `graph.json` from an injected working-dir path). On start pick a default port, fall back to the next free port if taken, and open the browser with `open`. Add npm script `serve` = `tsx src/server.ts <working-dir>`. Keep the static glue thin (no test). Verify: build the dashboard, run `npm run serve` against a fixture working dir, and confirm `curl localhost:<port>/api/graph` returns the graph JSON.

- [ ] Now that the server exists, add review endpoints and pending state. Put handlers in `src/review-endpoints.ts` (imported by `server.ts`) so they are testable: `POST /api/review/comment` (add a `PendingComment` — inline with `path`+`line`, or general), `GET /api/review/pending` (return `ReviewState`), `DELETE /api/review/comment/:id`, `POST /api/review/reply` (via `ghClient.replyToComment`), `POST /api/review/submit` (verdict APPROVE|REQUEST_CHANGES|COMMENT -> build the GitHub review payload from pending comments + general body -> `ghClient.createReview` -> clear pending on success). Persist `ReviewState` to `.pr-map/<key>/pending-review.json`. Inject `ghClient`. Write `src/review-endpoints.test.ts` with a fake `ghClient`: comments accumulate and persist, submit builds the correct payload and calls `createReview`, pending clears only on success. Verify: `npx vitest run src/review-endpoints.test.ts`.

- [ ] Now that the detail panel and the review endpoints exist, add the review UI to the dashboard. In the detail panel add a comment composer (inline when a diff line is selected, general otherwise) POSTing to `/api/review/comment`; a pending list (with delete) from `/api/review/pending`; a reply box on existing threads; and a submit control with the three verdicts POSTing to `/api/review/submit`, behind an explicit confirm step, showing success/failure. Verify: `npm --prefix dashboard run build` succeeds.

- [ ] Now that the fetcher, graph builder, server, and dashboard exist, create the Claude Code plugin and `/pr-map` skill that orchestrates them. Add `pr-map-plugin/.claude-plugin/plugin.json` and `pr-map-plugin/skills/pr-map/SKILL.md`. The skill instructs the agent to: (1) verify `gh auth status` and resolve the PR ref (default the current branch's PR), `gh pr checkout` if needed; (2) run the fetcher then `assembleGraph` to write `graph.json`; (3) ENRICH `graph.json` in place — read the PR description, diffs, and static graph; write a `summary` per node and a `why` per edge; add missing semantic edges as `origin: "llm"` with honest `confidence` and a `why`, never overwriting `static` edges, flagging uncertainty; (4) start the server (which opens the dashboard). Document the exact `graph.json` contract (from `src/types.ts`) inside `SKILL.md`. Verify: run `/pr-map <small real PR>` end to end; the dashboard opens with agent-written summaries/why and edges tagged by origin.

- [ ] Run full verification: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm --prefix dashboard run build`, and one real end-to-end `/pr-map` run against a sample PR (graph renders, a test comment posts, a COMMENT-verdict review submits to GitHub). Fix any failures.
