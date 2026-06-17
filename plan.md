# pr-map v2 — installable plugin + intelligent review

## Goal
Turn pr-map into an installable Claude Code plugin anyone can add (`/plugin install pr-map`)
and use as `/pr-map <PR>`, and make the review smarter: subagents (`pr-file-analyst`) analyze
each affected file in parallel — risks, suspected bugs, tests to touch, impact — while filling
the graph's summaries and "why"s. The reviewer sees the changed files, the indirectly-affected
files, and per-file review insights, in the browser. Design is approved in
`docs/superpowers/specs/2026-06-17-pr-map-plugin-design.md`.

## Approach
Wrap and extend the working v1 (do not rewrite it). For distribution, bundle the deterministic
runtime with esbuild into self-contained `node` scripts committed inside the plugin, served via
`${CLAUDE_PLUGIN_ROOT}`, with a root `marketplace.json` (mirrors how Egonex-AI/Understand-Anything
ships). For intelligence, the skill dispatches `pr-file-analyst` subagents in parallel; their
structured JSON is folded into `graph.json` by a deterministic, testable merge helper (not by the
agent hand-editing JSON). The only hook is a `SessionEnd` cleanup that kills the dashboard server.

## Constraints
- Do NOT build a standalone (non–Claude Code) product or handle any Anthropic API key.
- Do NOT add hooks other than the server-cleanup `SessionEnd` hook.
- Do NOT add sub-file node granularity (nodes stay file-level).
- Do NOT rewrite the working v1 core (`gh-client`, `fetch-pr`, `build-graph`, `repo-scan`,
  `server`, `review-endpoints`, `cli`, dashboard) — extend it.
- Do NOT let a `pr-file-analyst` subagent overwrite or remove edges whose `origin` is `static`;
  it may add `why` text and `origin: "llm"` semantic edges only.
- Do NOT add new static-edge languages (JS/TS + Python stay; llm semantic edges cover the rest).
- Do NOT write tests for pure UI or for thin glue (PID write, file copy). Test logic units only.
- Do NOT add Claude attribution to commits or PRs.

## Patterns to follow
- Error handling / DI: Result pattern in `src/result.ts`, Retry in `src/retry.ts`, injected deps as
  in `src/gh-client.ts` and `src/build-graph.ts` (`gitGrep`/`readContent`).
- Logic unit + test: follow `src/build-graph.ts` + `src/build-graph.test.ts` (vitest, fixtures under
  `src/__fixtures__/`, fakes injected).
- Graph types: `src/types.ts` (mirror in `dashboard/src/types.ts`).
- Dashboard sections: follow `dashboard/src/detail-panel.tsx`; node styling: `dashboard/src/file-node.tsx`.
- Plugin agent definition format: read `understand-anything-plugin/agents/graph-reviewer.md` in
  `github.com/Egonex-AI/Understand-Anything` via `gh api repos/Egonex-AI/Understand-Anything/contents/<path>`.
- Marketplace format: read that repo's `.claude-plugin/marketplace.json` the same way.
- Existing skill to rewrite: `pr-map-plugin/skills/pr-map/SKILL.md`.

## Verification commands
- Tests: `npx vitest run`
- Lint: `npx eslint .`
- Type check: `npx tsc --noEmit`
- Dashboard build: `npm --prefix dashboard run build`
- Plugin bundle: `npm run build:plugin`

## Current state
Working v1 in this repo (see archived `docs/plan-v1-build-completed.md`): `src/` deterministic
pipeline + `dashboard/` React app + `pr-map-plugin/` (`.claude-plugin/plugin.json` +
`skills/pr-map/SKILL.md`). The skill currently uses a hardcoded `$PR_MAP_HOME` and needs
`npm install` + `tsx` + a dashboard build, so it is NOT installable by others. 32 unit tests,
lint and typecheck green. Tooling: node v25, gh authenticated, esbuild not yet a dependency.

## Desired end state
- `npm run build:plugin` produces committed `pr-map-plugin/dist/{cli,server,merge}.js` and
  `pr-map-plugin/dashboard-dist/`, runnable with plain `node` (no npm install / tsx).
- `/plugin marketplace add ValentinDutra/pr-map` + `/plugin install pr-map` makes `/pr-map` available.
- Running `/pr-map <PR>` in a target repo: builds the static graph, dispatches `pr-file-analyst`
  subagents in parallel, merges their summaries/whys/insights/llm-edges into `graph.json`, and opens
  the dashboard showing the graph plus a "Review insights" section per node and a risk indicator on
  nodes with flagged risks/bugs. Review actions still post to GitHub via `gh`.
- The dashboard server is killed by the `SessionEnd` hook when the session ends.

## Data contracts (additions to `src/types.ts` + `dashboard/src/types.ts`)
- `NodeInsights`: `{ risks: string[]; suspectedBugs: string[]; testsToCheck: string[]; impact: string }`.
- `GraphNode` gains `insights?: NodeInsights`.
- `EnrichmentResult` (analyst output / merge input, in `src/merge-enrichment.ts`):
  `{ path: string; summary?: string; edgeWhys?: Record<string, string>; insights?: NodeInsights;
  semanticEdges?: { target: string; confidence: number; why: string }[] }`.

## Edge cases and risks
- esbuild may fail to fully bundle a dependency with dynamic requires. `express` and `open` normally
  bundle; if one resists, mark it external and add it to a minimal `pr-map-plugin/package.json`, OR
  replace it (node `http` instead of express, `child_process` open) — note which in `learnings.txt`.
- Committed `dist/`/`dashboard-dist/` are build outputs: they go stale when source or the dashboard
  changes. The final verification task re-runs `build:plugin` so the committed artifacts are current.
- A `pr-file-analyst` that errors or returns invalid JSON is skipped: that file keeps the static
  graph data; the merge helper ignores unparseable inputs and the skill logs which files were skipped.
- `${CLAUDE_PLUGIN_ROOT}` is only set when run as an installed plugin; for local dev keep using
  `npm run map`/`serve` with `tsx`.
- The cleanup hook assumes one active dashboard server (PID at a fixed path); a second concurrent
  server would orphan the first — acceptable for a single-user local tool.
- `SessionEnd` may not exist on older Claude Code; if so, document a manual `kill` and do not use
  `Stop` (it fires every turn).

## Tasks

- [x] Add the insights data contract. In `src/types.ts` add `export interface NodeInsights { risks: string[]; suspectedBugs: string[]; testsToCheck: string[]; impact: string }` and add `insights?: NodeInsights` to `GraphNode`. Mirror both into `dashboard/src/types.ts` (it is a hand-kept copy). Type-only change, no test. Verify: `npx tsc --noEmit` and `npm --prefix dashboard run build` both pass.

- [x] Now that `NodeInsights` exists, create `src/merge-enrichment.ts`. Define `EnrichmentResult` (see Data contracts) and a pure `mergeEnrichment(graph: PrGraph, results: EnrichmentResult[]): PrGraph` that, per result: sets `summary`/`insights` on the node whose `id` equals `result.path`; sets `why` on any edge whose `id` is a key of `edgeWhys` (static OR llm — adding a why never alters edge identity); appends each `semanticEdges` entry as a new edge `{ id: `${path}->${target}:semantic:outgoing`, source: path, target, kind: 'semantic', direction: 'outgoing', origin: 'llm', confidence, why }`, skipping ids that already exist and NEVER removing/altering existing `origin: 'static'` edges. Also add `mergeEnrichmentFromDir(dataDir)` that reads `graph.json` + every `*.json` in `<dataDir>/enrichment/` (ignoring files that fail `JSON.parse`), runs `mergeEnrichment`, and writes `graph.json` back; and a `main()` reading the dataDir from `process.argv[2]`. Follow the Result/IO style of `src/build-graph.ts` (`writeGraph`). Write `src/merge-enrichment.test.ts` (follow `src/build-graph.test.ts`): assert summary/insights/why are merged, a semantic edge is added as `origin: 'llm'`, and a static edge is never modified except for its `why`. Verify: `npx vitest run src/merge-enrichment.test.ts`.

- [x] Make `src/server.ts` distribution-ready. Replace the single `DASHBOARD_DIST` constant with a resolver that picks the first existing candidate relative to `import.meta.url`: `../dashboard-dist` (bundled layout: `pr-map-plugin/dist/server.js`) then `../dashboard/dist` (dev layout: `src/server.js`). On `startServer`, after binding, write the chosen port's PID (`process.pid`) to `join(tmpdir(), 'pr-map-server.pid')` (from `node:os`), overwriting it. Keep everything else (Result usage, `PRMAP_NO_OPEN`, `/api` 404 guard) unchanged. No new test (thin glue). Verify: `npm --prefix dashboard run build` then `PRMAP_NO_OPEN=1 npx tsx src/server.ts <a dir containing graph.json>` serves `/api/graph` (curl) and writes the pid file.

- [x] Now that the runtime entrypoints are distribution-ready, add the plugin bundle build. Add `esbuild` as a devDependency. Create `scripts/build-plugin.mjs` that: builds the dashboard (`vite build`) — or assumes the npm script chains it — then esbuild-bundles `src/cli.ts`, `src/server.ts`, and `src/merge-enrichment.ts` to `pr-map-plugin/dist/cli.js`, `pr-map-plugin/dist/server.js`, `pr-map-plugin/dist/merge.js` (`format: 'esm'`, `platform: 'node'`, `bundle: true`, `target: 'node20'`), and copies `dashboard/dist` to `pr-map-plugin/dashboard-dist/`. Add npm script `build:plugin` = `npm --prefix dashboard run build && node scripts/build-plugin.mjs`. Commit the produced `pr-map-plugin/dist/` and `pr-map-plugin/dashboard-dist/` (remove them from `.gitignore` if ignored). Verify: `npm run build:plugin`, then `PRMAP_NO_OPEN=1 node pr-map-plugin/dist/server.js <dir with graph.json>` serves `/api/graph` (curl) and `node pr-map-plugin/dist/cli.js` exits non-zero with a clear gh error (proving the bundle loads).

- [x] Create the `pr-file-analyst` agent definition at `pr-map-plugin/agents/pr-file-analyst.md`. Read `understand-anything-plugin/agents/graph-reviewer.md` from `github.com/Egonex-AI/Understand-Anything` (via `gh api`) first to match the frontmatter/format. The agent is a focused single-file PR reviewer: given a file path, its diff, its content, and its graph neighbors, it returns ONLY a JSON object matching `EnrichmentResult` from `src/merge-enrichment.ts` — `summary`, `edgeWhys` (edgeId → plain-language why), `insights` ({risks, suspectedBugs, testsToCheck, impact}), and optional `semanticEdges` with honest `confidence` and a `why`, flagging uncertainty. Document the exact schema in the agent body. No code, no test. Verify: the file exists and its YAML frontmatter parses (`python3 -c "import yaml,sys; yaml.safe_load(open('pr-map-plugin/agents/pr-file-analyst.md').read().split('---')[1])"`).

- [x] Now that the bundle, the merge helper, and the analyst agent exist, rewrite `pr-map-plugin/skills/pr-map/SKILL.md` to orchestrate them. Replace all `$PR_MAP_HOME` references with `${CLAUDE_PLUGIN_ROOT}`. Steps: verify `gh auth`; resolve the PR ref and `gh pr checkout`; run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <ref> "$(pwd)"` to write the static `graph.json`; dispatch `pr-file-analyst` subagents in parallel over the changed files (≤10 changed files → one per file; >10 → batches of ~5 files), writing each subagent's returned JSON to `<dataDir>/enrichment/<index>.json`; run `node "${CLAUDE_PLUGIN_ROOT}/dist/merge.js" "<dataDir>"` to fold them into `graph.json`; start `node "${CLAUDE_PLUGIN_ROOT}/dist/server.js" "<dataDir>"`. Keep the `EnrichmentResult`/graph contract documented inline. No automated test (it is agent orchestration). Verify: the file parses as Markdown with valid YAML frontmatter and contains no remaining `$PR_MAP_HOME` (`grep -c PR_MAP_HOME` is 0).

- [x] Add the marketplace manifest. Read `.claude-plugin/marketplace.json` from `github.com/Egonex-AI/Understand-Anything` (via `gh api`) for the schema, then create `.claude-plugin/marketplace.json` at the repo root listing the `pr-map` plugin located at `./pr-map-plugin`, with owner/metadata. Ensure `pr-map-plugin/.claude-plugin/plugin.json` keeps its name/description/version. Verify: both JSON files parse (`python3 -c "import json; json.load(open('.claude-plugin/marketplace.json'))"`) and the plugin `source`/path resolves to an existing directory.

- [x] Now that the server writes a PID file, add the cleanup hook. Create `pr-map-plugin/hooks/cleanup-server.sh` (executable) that reads `${TMPDIR:-/tmp}/pr-map-server.pid`, and if the PID is running, kills it and removes the file. Register it as a `SessionEnd` hook in `pr-map-plugin/.claude-plugin/plugin.json` (or a `pr-map-plugin/hooks/hooks.json` if that is the plugin convention — match what the Claude Code plugin schema expects). No test. Verify: the script is executable and runs without error when no pid file exists (`bash pr-map-plugin/hooks/cleanup-server.sh; echo $?` is 0), and the plugin.json/hooks.json parses as JSON.

- [x] Now that `insights` exists in the contract, add the "Review insights" section to the dashboard detail panel. In `dashboard/src/detail-panel.tsx` add a section (following the existing "Connections" section markup in that file) that, when `node.insights` is present, lists `risks`, `suspectedBugs`, `testsToCheck`, and the `impact` note. Add a sample `insights` block (with at least one `risk` and one `suspectedBug`) to one PR node in `dashboard/src/__fixtures__/graph.json` so the section renders. No test (UI). Verify: `npm --prefix dashboard run build` passes.

- [x] Now that the insights section and the fixture insights exist, add a node-level risk indicator. In `dashboard/src/file-node.tsx` add a `hasRisk: boolean` field to `FileNodeData` and render a small red dot/border when it is true (follow the existing class-based styling in that file). In `dashboard/src/graph-view.tsx` `buildFlow`, set each node's `hasRisk` as `Boolean(node.insights && node.insights.risks.length + node.insights.suspectedBugs.length > 0)`. No test (UI). Verify: `npm --prefix dashboard run build` passes.

- [ ] Run full verification: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm --prefix dashboard run build`, and `npm run build:plugin` (which refreshes and must leave `pr-map-plugin/dist/` + `pr-map-plugin/dashboard-dist/` current — commit the refreshed artifacts). Then one end-to-end check: from a checkout of a small real PR, run `node pr-map-plugin/dist/cli.js <ref> "$(pwd)"`, hand-write one `enrichment/0.json`, run `node pr-map-plugin/dist/merge.js "<dataDir>"`, start `node pr-map-plugin/dist/server.js "<dataDir>"`, and confirm `/api/graph` returns a node carrying `insights`. Fix any failures.
