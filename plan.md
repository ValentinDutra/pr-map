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
- Error handling: Result pattern in `src/result.ts` — return `Result<T, E>`, do not throw
  for expected failures.
- Transient failures: Retry pattern in `src/retry.ts`, applied inside the gh executor.
- Dependency Injection: inject the command executor into the gh-client; inject the
  gh-client into the fetcher and the review endpoints. Tests pass fakes.
- React Flow graph rendering: read `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
  in `github.com/Egonex-AI/Understand-Anything` (fetch via `gh api .../contents/...`) and replicate the structure.
- Diff/code rendering: read that repo's `.../components/CodeViewer.tsx` for the prism-react-renderer pattern.
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
Reference patterns (study, do not fork): `github.com/Egonex-AI/Understand-Anything` (MIT).

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

## Data contracts (define once, in `src/types.ts`)
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

- [ ] Scaffold the Node/TypeScript project and define the data contracts. Create `package.json` (deps: `express`, `open`; devDeps: `typescript`, `tsx`, `vitest`, `eslint`, `@types/node`, `@types/express`), `tsconfig.json` (strict, NodeNext, no emit), and `eslint.config.mjs`. Create `src/types.ts` with all contracts from the "Data contracts" section, `src/result.ts` (a `Result<T, E>` type with `ok`/`err` constructors and an `isOk` guard), and `src/retry.ts` (a `retry(operation, options)` helper that retries a `Result`-returning async op on failure with a fixed number of attempts and a delay). Add npm scripts: `typecheck` (`tsc --noEmit`), `lint` (`eslint .`), `test` (`vitest run`). Verify: `npx tsc --noEmit` and `npx eslint .` pass.

- [ ] Create `src/gh-client.ts`: an injectable client over the `gh` CLI. Define `type CommandExecutor = (args: string[], stdin?: string) => Promise<Result<string, GhError>>` and `createGhClient(execute: CommandExecutor)` returning methods `getPrMetadata(ref)`, `listChangedFiles(ref)`, `getDiff(ref)`, `getFileContent(path, ref)`, `createReview(payload)`, `replyToComment(prNumber, commentId, body)`. Each returns a `Result`. Wrap `execute` calls with the `retry` helper from `src/retry.ts` for transient failures. The real executor (a thin `spawn('gh', args)` wrapper returning `Result`) lives in the same file as `createDefaultExecutor()`. Follow the Result/Retry/DI patterns in "Patterns to follow". Write `src/gh-client.test.ts` using a fake `CommandExecutor` that returns canned JSON — assert the client builds the right `gh` args and parses output; assert retry happens on a failing-then-succeeding executor. Verify: `npx vitest run src/gh-client.test.ts`.

- [ ] Create `src/fetch-pr.ts`: `fetchPr(ghClient, ref): Promise<Result<RawPr, FetchError>>` that resolves the PR ref (number, URL, or current branch), then assembles `RawPr` = PR metadata + changed files (path, status, additions, deletions) + per-file diff + full content of each changed file at the PR head, using the injected `ghClient`. Add a writer `writeRaw(rawPr, workingDir)` that saves `.pr-map/<owner>-<repo>-<number>/raw.json`. Inject `ghClient` (do not construct it inside). Write `src/fetch-pr.test.ts` with a fake `ghClient` returning canned metadata/files/diffs; assert `RawPr` is assembled correctly and the working-dir key is built right. Verify: `npx vitest run src/fetch-pr.test.ts`.

- [ ] Create `src/build-graph.ts` (nodes only, for now): `buildNodes(rawPr): GraphNode[]` mapping each changed file to a `GraphNode` (`id`/`path` = repo-relative path, `language` by file extension via a small extension map, `inPr: true`, `status`, `additions`, `deletions`, empty `summary`). Renamed files use the new path as `id`. Write `src/build-graph.test.ts` (nodes section) asserting language detection and field mapping over a small fixture `RawPr`. Verify: `npx vitest run src/build-graph.test.ts`.

- [ ] Create `src/import-rules.ts` and add outgoing-edge detection to `src/build-graph.ts`. `import-rules.ts` exports `ImportRule` entries for JS/TS (`import ... from '...'`, `require('...')`, `export ... from '...'`) and Python (`import a.b`, `from a.b import c`), each with a `resolve(specifier, fromPath, repoFiles)` that returns candidate repo-relative paths (relative specifiers resolved against the importing file's dir, trying known extensions and `index.*` / `__init__.py`; bare/node_modules specifiers return none). In `build-graph.ts` add `addOutgoingEdges(nodes, rawPr, repoFiles)`: for each PR node, scan its content for imports, resolve them, and create a `GraphEdge` (`kind: import`, `direction: outgoing`, `origin: static`, `confidence: 1`) to the target; if the target is a repo file not already a node, add it as a neighbor node (`inPr: false`). Add fixtures under `src/__fixtures__/` and extend `build-graph.test.ts` to cover JS/TS and Python resolution and neighbor creation. Verify: `npx vitest run src/build-graph.test.ts`.

- [ ] Add incoming-edge (blast-radius) detection to `src/build-graph.ts`. Add `addIncomingEdges(nodes, prFilePaths, repoRoot, gitGrep)` where `gitGrep` is an injected function (default shells out to `git grep -l`) so it is testable: for each PR file, derive its importable specifier forms (relative path stems, module dotted path) and `git grep` the repo for files that reference them; confirm each candidate with the `import-rules` resolver to drop false positives; add confirmed importers as neighbor nodes (`inPr: false`) and create edges (`kind: import`, `direction: incoming`, `origin: static`, `confidence: 1`) from the importer to the PR file. Inject `gitGrep` (do not call git directly in the core function). Extend `build-graph.test.ts` with a fake `gitGrep` returning canned matches; assert importers become neighbors with incoming edges and that non-confirming matches are dropped. Verify: `npx vitest run src/build-graph.test.ts`.

- [ ] Add graph assembly and persistence to `src/build-graph.ts`. `assembleGraph(rawPr, repoFiles, gitGrep): PrGraph` runs `buildNodes` -> `addOutgoingEdges` -> `addIncomingEdges`, dedupes nodes/edges by id, sets `meta` from `rawPr` and a `generatedAt` passed in (do not call `Date.now()` inside — accept it as an argument), and leaves `summary`/`why` empty for the agent. Add `writeGraph(graph, workingDir)` writing `.pr-map/<owner>-<repo>-<number>/graph.json`. Extend `build-graph.test.ts` to assert a full `PrGraph` is assembled and deduped from a fixture. Verify: `npx vitest run src/build-graph.test.ts`.

- [ ] Scaffold the dashboard and render the graph. Create `dashboard/` as a Vite + React 19 + TypeScript app with deps `@xyflow/react`, `@dagrejs/dagre`, `tailwindcss` (v4 via `@tailwindcss/vite`). Load a `PrGraph` (from a checked-in fixture `dashboard/src/__fixtures__/graph.json` for now), lay it out with dagre, and render with React Flow: PR nodes vs neighbor nodes (`inPr:false`) styled differently (e.g., neighbors dimmed/dashed); edges labeled by `kind` with `origin` and `confidence` shown (e.g., `static` solid, `llm` dashed + confidence in the tooltip). Add zoom/pan (React Flow defaults) and a text search box that highlights matching nodes. Read `GraphView.tsx` from the reference repo first and replicate its structure. Verify: `npm --prefix dashboard run build` succeeds and the fixture graph renders when run with `npm --prefix dashboard run dev`.

- [ ] Add the node detail + diff side panel to the dashboard. Clicking a node opens a panel showing the file path, its `summary`, the list of connected edges with their `why`, `origin`, and `confidence`, and the file's unified diff rendered with `prism-react-renderer` (read the reference repo's `CodeViewer.tsx` for the pattern). Neighbor nodes (no diff) show their relationships only. Use `zustand` for the selected-node state. Verify: `npm --prefix dashboard run build` succeeds and clicking a node in `dev` shows the diff.

- [ ] Create `src/server.ts`: a Node/Express server that serves the built dashboard (`dashboard/dist`) and exposes `GET /api/graph` (reads `graph.json` from the active working dir). On start it picks a default port, falls back to the next free port if taken, and opens the browser with `open`. Add an npm script `serve` (`tsx src/server.ts <working-dir>`). Inject the working-dir path (do not hardcode). No tests for the static-serving glue; keep it thin. Verify: build the dashboard, run `npm run serve` against a fixture working dir, and confirm `GET /api/graph` returns the graph and the page loads.

- [ ] Add the review endpoints and pending-review state to `src/server.ts` (extract handlers into `src/review-endpoints.ts` for testability). Endpoints: `POST /api/review/comment` (add a `PendingComment` — inline with `path`+`line`, or general — to the local pending review), `GET /api/review/pending` (return current `ReviewState`), `DELETE /api/review/comment/:id` (remove a pending comment), `POST /api/review/reply` (reply to an existing thread via `ghClient.replyToComment`), and `POST /api/review/submit` (take a verdict APPROVE|REQUEST_CHANGES|COMMENT, build the GitHub review payload from the pending comments + general body, call `ghClient.createReview`, and clear the pending file on success). Persist `ReviewState` to `.pr-map/<key>/pending-review.json`. Inject `ghClient` into the handlers. Write `src/review-endpoints.test.ts` with a fake `ghClient`: assert comments accumulate and persist, submit builds the correct payload and calls `createReview`, and pending is cleared only on success. Verify: `npx vitest run src/review-endpoints.test.ts`.

- [ ] Add the review UI to the dashboard. In the node/line detail panel add a comment composer (inline comment when a diff line is selected, file-level/general otherwise) that POSTs to `/api/review/comment`; a pending-comments list (with delete) reading `/api/review/pending`; a reply box on existing threads; and a submit control with the three verdict options that POSTs to `/api/review/submit` and shows success/failure. Submit always requires an explicit click and a confirm step. Verify: `npm --prefix dashboard run build` succeeds and, against a running server with a fake-backed gh-client, adding a comment and submitting hits the right endpoints.

- [ ] Create the Claude Code plugin and the `/pr-map` skill that orchestrates everything. Add `pr-map-plugin/.claude-plugin/plugin.json` and `pr-map-plugin/skills/pr-map/SKILL.md`. The skill instructs the agent to: (1) verify `gh auth status` and resolve the PR ref (default to the current branch's PR), `gh pr checkout` it if needed; (2) run the fetcher and the graph builder to produce `graph.json`; (3) ENRICH the graph in place — read the PR description and diffs and the static graph, write a `summary` for each node and a `why` for each edge, and add any missing semantic edges as `origin: "llm"` with an honest `confidence` and a `why`, never overwriting `static` edges, flagging uncertainty; (4) start the server, which opens the dashboard. Document the exact `graph.json` contract the agent must fill (from `src/types.ts`) inside `SKILL.md`. Verify: run `/pr-map <a small real PR>` end to end and confirm the dashboard opens with agent-written summaries/why and edges tagged by origin.

- [ ] Run full verification: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm --prefix dashboard run build`, and one real end-to-end `/pr-map` run against a sample PR (graph renders, a test comment posts, a COMMENT-verdict review submits to GitHub). Fix any failures.
