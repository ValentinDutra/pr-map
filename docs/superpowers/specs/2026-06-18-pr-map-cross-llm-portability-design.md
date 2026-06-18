# pr-map Cross-LLM Portability (#7)

## Goal

Make pr-map usable beyond Claude Code: by any coding agent (Codex, Gemini CLI) and
standalone with no agent at all. The one Claude-specific piece is AI enrichment, which today
runs only as Claude Code `pr-file-analyst` subagents. Move enrichment into a deterministic
Node script behind a provider switch (Ollama default, OpenAI-compatible optional) that emits
the same `enrichment/<i>.json` contract the rest of the pipeline already consumes. The static
graph, merge, and dashboard are already deterministic Node and do not change.

Project principle preserved: the LLM only produces suggestions; the human does the real
review in the browser. Nothing here posts or decides on the user's behalf.

## Current state

```
cli.js     <ref> <repoRoot>   -> graph.json            deterministic Node
<enrich>                      -> enrichment/<i>.json   CLAUDE-ONLY (subagents)  <-- the gap
merge.js   <dataDir>          -> graph.json (enriched) deterministic Node
server.js  <dataDir>          -> dashboard             deterministic Node
```

Enrichment is the single non-portable stage: SKILL.md tells the Claude agent to dispatch
`pr-file-analyst` subagents and write each result to `enrichment/<i>.json`, then `merge.js`
folds them in. The `EnrichmentResult` contract `merge.js` consumes:

```
{ path, summary, edgeWhys: {<edgeId>: why}, insights: {risks[], suspectedBugs[],
  testsToCheck[], impact}, semanticEdges: [{target, confidence, why}] }
```

## Approach: coexist

- A new Node enricher emits the same `enrichment/<i>.json`. `merge.js`, `server.js`, and the
  dashboard are untouched.
- The Claude Code path is unchanged: it keeps dispatching subagents (richest enrichment, full
  file/tool access). Claude never calls the Node enricher.
- Every other runtime (Codex, Gemini, standalone) uses the Node enricher.
- A new standalone orchestrator runs the whole pipeline in one command.

Rejected alternative: unify everyone on the Node enricher (drop subagents). Rejected because
it would lower enrichment quality inside Claude Code, where subagents can grep and read the
wider codebase. Coexist keeps the best path on Claude and a portable path everywhere else.

## Target pipeline

```
cli.js     <ref> <repoRoot>   -> graph.json            (exists, unchanged)
enrich.js  <dataDir>          -> enrichment/<i>.json   (NEW: calls the LLM provider)
merge.js   <dataDir>          -> graph.json (enriched) (exists, unchanged)
server.js  <dataDir>          -> dashboard             (exists, unchanged)

pr-map.js  <ref> [repoRoot]   -> runs all four in order (NEW: standalone orchestrator)
```

## Components

### Provider abstraction — `src/llm-provider.ts`

- `interface LlmProvider { complete(prompt: string): Promise<Result<string, LlmError>> }`
  (dependency-injected so the enricher and tests never touch real network directly).
- `createOllamaProvider({ model, baseUrl })` — POST `{baseUrl}/api/chat`.
- `createOpenAiCompatibleProvider({ baseUrl, apiKey, model })` — POST
  `{baseUrl}/v1/chat/completions`. Covers OpenAI, Groq, Together, OpenRouter, and a remote
  Ollama `/v1` endpoint.
- `selectProvider(env): Result<LlmProvider, ConfigError>` — reads the env switch, validates it
  (the OpenAI-compatible provider requires a base URL and key), and fails fast with a readable
  message instead of a cryptic fetch error.
- Each HTTP call is wrapped in the Retry pattern with a per-call timeout.

### Enricher — `src/enrich.ts` -> `dist/enrich.js`

- Input: `dataDir`. Reads `graph.json`, takes `inPr` nodes.
- Batching mirrors the skill: <= 10 changed files -> one prompt per file; > 10 -> batches of
  ~5 files per prompt.
- Prompt builder constructs each prompt from the node's `patch`, the edges touching it, and
  neighbor summaries — the same inputs `pr-file-analyst` receives — using a shared template
  that encodes the `EnrichmentResult` contract, so both paths produce comparable output.
- Runs with a bounded concurrency pool (`PRMAP_ENRICH_CONCURRENCY`, default 4).
- Parses responses tolerantly (strips ```json fences and surrounding prose) and validates the
  shape before writing.
- Fail-open per batch: a provider error, timeout, or unparseable response skips that batch and
  logs which files went un-enriched. The static graph still renders. Mirrors the skill's "a
  subagent that fails is fine to skip."
- Writes `enrichment/<i>.json`.

### Standalone orchestrator — `src/pr-map.ts` -> `dist/pr-map.js`

- `pr-map <ref> [repoRoot]` runs fetch+graph -> enrich -> merge -> start server.
- The fetch+graph body currently inside `cli.ts`'s `main()` is extracted into a shared
  exported function that both `cli.ts` and `pr-map.ts` call, so there is one source of truth.
- Failures surface as `Result` with actionable messages. On success it opens the dashboard,
  same as `server.js` today.

### Config — env switch

| Variable | Default | Purpose |
|---|---|---|
| `PRMAP_LLM_PROVIDER` | `ollama` | `ollama` \| `openai-compatible` |
| `PRMAP_LLM_MODEL` | `qwen2.5-coder` (ollama) | model name |
| `PRMAP_LLM_BASE_URL` | `http://localhost:11434` (ollama) | endpoint; required for `openai-compatible` |
| `PRMAP_LLM_API_KEY` | none | hosted key; read from env, never logged |
| `PRMAP_ENRICH_CONCURRENCY` | `4` | parallel provider calls |
| `PRMAP_LLM_TIMEOUT_MS` | `60000` | per-call timeout |

All optional with working defaults so `pr-map <ref>` runs against a local Ollama out of the box.

## Per-agent delivery (Layer 1 — thin wrappers over the engine)

The engine (the Node scripts above) is the portable substrate every agent shells out to. Each
agent gets a native wrapper in its own format. Formats verified against current docs:

- **Claude Code** — existing plugin + `skills/pr-map/SKILL.md` (subagent enrichment). Add one
  line noting non-Claude runtimes use `pr-map.js`.
- **Codex** — Agent Skill at `skills/pr-map/SKILL.md` (Codex reads `~/.codex/skills/**/SKILL.md`;
  custom prompts under `~/.codex/prompts/` are deprecated) plus an `AGENTS.md` note. The skill
  body runs `node "$ENGINE/pr-map.js" <ref>` (engine enrichment, no subagents).
- **Gemini CLI** — an extension directory: `gemini-extension.json` manifest (name, version,
  description; a `settings` array exposing the provider config), a `GEMINI.md` context file, and
  `commands/pr-map.toml` defining a `/pr-map` command that runs the engine. Installed via
  `gemini extensions install <path|github-url>`.

Claude and Codex both use `SKILL.md`, so most of that text is shared; only the enrichment step
differs (subagents vs engine command). The provider env switch is identical across all three.

## Error handling

Result pattern throughout. Retry around every provider HTTP call. Fail-open per enrichment
batch. Configuration errors (e.g. `openai-compatible` without a base URL/key) return a clear
`Result` error before any network call.

## Testing (minimum, maximum value; provider mocked via DI)

- `selectProvider` env resolution, including the misconfiguration error paths.
- Prompt builder includes the node's patch and its touching edges.
- Tolerant JSON parsing (code fences, leading/trailing prose) and the fail-open skip behavior.
- No live Ollama or hosted-API integration tests — those are liability.

## Scope boundaries / non-goals

- No MCP server. pr-map ends in a human browser review, not an agent tool-result, so MCP adds
  protocol overhead without value. Revisit only if agents need to consume the map as data.
- No change to `merge.js`, `server.js`, or the dashboard.
- No change to Claude Code's subagent enrichment.
- No new languages for the static import scanner (tracked separately).
- `enrich.js` and `pr-map.js` are added to the esbuild entry points; the bundle is rebuilt as
  usual (source-only PRs, bundle rebuilt on main).

## Risks

- Small local models may emit weaker enrichment or malformed JSON. Mitigated by tolerant
  parsing, fail-open, and recommending a capable default model.
- Third-party agent packaging formats (Gemini extension manifest, Codex skill layout) evolve.
  Isolated to the wrapper files; the engine is unaffected.

## Sources

- [Codex Agent Skills](https://developers.openai.com/codex/skills)
- [Codex custom prompts (deprecated)](https://developers.openai.com/codex/custom-prompts)
- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Gemini CLI extensions](https://google-gemini.github.io/gemini-cli/docs/extensions/)
- [Gemini CLI extension reference](https://geminicli.com/docs/extensions/reference/)
