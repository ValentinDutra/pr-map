# pr-map: installable plugin + intelligent review — design

## Goal

Turn pr-map from a local tool (run via hardcoded paths) into an **installable Claude Code
plugin** anyone can add and use as `/pr-map <PR>`, and make the review itself smarter by
having **subagents analyze each affected file** (risks, suspected bugs, tests to touch,
impact) in parallel while enriching the graph. Keep the original objective: reviewing a PR
is easier because you see, visually, the changed files and the files indirectly affected
even when they were not changed.

"Everyone" means: anyone with Claude Code (or a skills-compatible agent). The LLM work is
done by the user's own Claude Code session — no API key, no extra billing. A standalone
(non–Claude Code) product is explicitly out of scope for now.

## Current state

A working tool already exists in this repo:
- `src/` — deterministic Node/TypeScript pipeline: `gh-client`, `fetch-pr`, `build-graph`
  (nodes + static outgoing/incoming edges via `git grep`), `repo-scan`, `server` (Express:
  serves the dashboard + `/api/graph` + review endpoints), `review-endpoints`, `cli`.
- `dashboard/` — React + Vite + React Flow + dagre + Tailwind interactive graph with a
  detail panel, diff view, and review UI (inline/general comments, reply, submit verdict).
- `pr-map-plugin/` — `.claude-plugin/plugin.json` + `skills/pr-map/SKILL.md`, but the skill
  references `$PR_MAP_HOME` (a hardcoded local path) and the runtime needs `npm install` +
  `tsx` + a dashboard build, so it is NOT installable by others.

Verified working end-to-end (read-only against `slugify#75`, write path against a throwaway
PR). 32 unit tests, lint and typecheck green.

## What we are building (four components)

### 1. Distribution — an installable plugin

The plugin must carry everything it needs to run with plain `node`, with no `npm install`
or `tsx` at the user's end.

- **Bundle the runtime with esbuild.** A build step bundles `src/cli.ts` and `src/server.ts`
  into self-contained ESM files `pr-map-plugin/dist/cli.js` and `pr-map-plugin/dist/server.js`
  with their npm dependencies (`express`, `open`) inlined. The dashboard is built once with
  Vite and its static output is copied to `pr-map-plugin/dashboard-dist/`.
- **Commit the built artifacts** (`pr-map-plugin/dist/`, `pr-map-plugin/dashboard-dist/`) so
  a fresh install runs immediately. (Chosen approach A — bundle + commit — over B: publish to
  npm and `npx pr-map@latest`, and C: `npm install` on install, which Claude Code does not run.)
- **Use `${CLAUDE_PLUGIN_ROOT}`** in SKILL.md, agents, and hooks instead of `$PR_MAP_HOME`.
  Scripts run as `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <ref> "$(pwd)"` and
  `node "${CLAUDE_PLUGIN_ROOT}/dist/server.js" <dataDir>`.
- **`server.js` resolves the dashboard** relative to its own location
  (`new URL('../dashboard-dist', import.meta.url)`), not a repo-relative path.
- **Marketplace.** Add `.claude-plugin/marketplace.json` at the repo root listing the `pr-map`
  plugin located at `pr-map-plugin/`. Install flow:
  `/plugin marketplace add ValentinDutra/pr-map` → `/plugin install pr-map` → `/pr-map <PR>`.
- The local dev workflow (`tsx`, `npm run map/serve`, vitest) stays unchanged for development;
  the bundle is a build artifact for distribution.

### 2. Subagents — review intelligence + scale

A new agent definition `pr-map-plugin/agents/pr-file-analyst.md` (a focused PR-file reviewer).
After the deterministic `cli.js` writes the static `graph.json`, the skill orchestrates:

- For each changed file, **dispatch a `pr-file-analyst` in parallel**. Concrete rule:
  ≤ 10 changed files → one subagent per file; > 10 changed files → batch ~5 files per
  subagent (so a 40-file PR uses 8 subagents, not 40), capping concurrency.
- Each subagent receives: the file path, its diff/patch, its content, and its graph neighbors
  (the nodes/edges touching it). It returns **structured JSON**:
  - `summary` — what the file does and its role in this PR (fills `GraphNode.summary`).
  - `edgeWhys` — a `why` per edge id touching this file (fills `GraphEdge.why`).
  - `insights` — `{ risks[], suspectedBugs[], testsToCheck[], impact }`.
  - optionally `semanticEdges` — links the static pass missed, to add as `origin: "llm"`
    edges with an honest `confidence` and a `why`.
- The skill (main agent) **merges** all returned JSON into `graph.json`: writes summaries,
  whys, and insights onto the matching nodes/edges; appends `llm` edges; never overwrites
  edges whose `origin` is `static`.

The orchestration lives in SKILL.md (the agent dispatches subagents via its Task/Agent tool);
it is not new deterministic code. This both adds review value and scales to large PRs.

### 3. Insights in the dashboard

Extend the data contract and UI:
- `GraphNode` gains `insights?: { risks: string[]; suspectedBugs: string[]; testsToCheck: string[]; impact: string }`
  in both `src/types.ts` and `dashboard/src/types.ts`.
- The node detail panel shows a **"Review insights"** section: risks, suspected bugs, tests
  to check, and the impact note, when present.
- Nodes that have any `risks` or `suspectedBugs` get a **visual indicator** (e.g. a colored
  border/badge) so the reviewer can jump straight to what matters.
- `pr-file-analyst`'s structured output schema is the source of truth for these fields.

### 4. Cleanup hook

- `server.js` writes its own PID to a **fixed path** the hook can find without knowing the
  per-PR dataDir: `${TMPDIR:-/tmp}/pr-map-server.pid` (overwritten on each start; we assume
  one active dashboard server at a time).
- A **`SessionEnd`** hook, declared by the plugin (`pr-map-plugin/hooks/`), runs a small
  script that reads that PID file and kills the process (then removes the file) so no
  orphaned `node` server is left listening. This is the only hook.
- If `SessionEnd` is unavailable in the installed Claude Code version, fall back to
  documenting a manual stop; do not use `Stop` (it fires every turn and would kill the
  server mid-use).

## Data flow (end to end)

1. User runs `/pr-map <PR>` inside a checkout of the target repo.
2. Skill: verify `gh auth`, resolve the PR ref, `gh pr checkout` it.
3. `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js <ref> "$(pwd)"` → writes static `graph.json`
   under `<repo>/.pr-map/<owner>-<repo>-<number>/`, prints `{ dataDir, ... }`.
4. Skill dispatches `pr-file-analyst` subagents in parallel over the changed files; merges
   their JSON (summaries, whys, insights, llm edges) into `graph.json`.
5. `node ${CLAUDE_PLUGIN_ROOT}/dist/server.js <dataDir>` → serves the dashboard, writes its
   PID, opens the browser.
6. User reviews in the browser: graph + diffs + insights; inline/general comments, replies,
   and a verdict submitted to GitHub via `gh`.
7. On session end, the `SessionEnd` hook kills the server.

## Error handling

- Reuse the existing Result/Retry patterns in the deterministic code unchanged.
- A `pr-file-analyst` subagent that fails or returns invalid JSON is skipped: its file keeps
  the static graph data (empty summary/why/insights) rather than failing the whole run; the
  skill logs which files were not enriched.
- The empty-review, prNumber, async-handler, and `/api` 404 guards added in the recent
  bug-fix round remain.

## Testing

- Keep tests minimal and on logic units (the user's standard: minimum tests, maximum value).
- New deterministic code to test: the esbuild bundle build is verified by `node dist/cli.js`
  and `node dist/server.js` running (a smoke check, not a unit test); the PID-write/cleanup
  is thin glue.
- Add a unit test only where there is real logic: the `insights` field threading through the
  graph types is type-only (no test); the merge of subagent JSON into `graph.json` is done by
  the agent (no unit test), but if a deterministic merge helper is introduced, test it.
- Validate end to end with one read-only run (public PR) and confirm the dashboard renders
  insights; validate the write path on a throwaway PR (COMMENT verdict only — GitHub forbids
  approving your own PR).

## Non-goals (scope boundaries)

- No standalone (non–Claude Code) product; no Anthropic API key handling.
- No hooks beyond the server-cleanup `SessionEnd` hook.
- No sub-file node granularity (nodes stay file-level).
- No rewrite of the working core (fetch / static graph / server / dashboard) — wrap and extend.
- No new languages for static edges beyond the existing JS/TS + Python (llm semantic edges
  cover the rest, clearly flagged).
