# Using pr-map outside Claude Code

pr-map's engine is a set of self-contained `node` scripts under `pr-map-plugin/dist`. The static
graph, merge, and dashboard are deterministic; only the AI enrichment step calls a language model,
behind a provider switch. That makes pr-map usable from any coding agent — or standalone with no
agent at all.

Inside Claude Code, enrichment runs as `pr-file-analyst` subagents (Claude itself). Everywhere
else it runs through the bundled `enrich.js` against the provider you configure.

## One-time setup

1. Clone this repository and build the engine once:
   ```
   npm install
   npm run build:plugin
   ```
2. Point `PRMAP_HOME` at the clone so the wrappers can find the engine:
   ```
   export PRMAP_HOME=/path/to/pr-map
   ```
3. Make sure you have an LLM provider. The default is local [Ollama](https://ollama.com):
   ```
   ollama pull qwen2.5-coder
   ```

## Provider switch (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PRMAP_LLM_PROVIDER` | `ollama` | `ollama` or `openai-compatible` |
| `PRMAP_LLM_MODEL` | `qwen2.5-coder` (ollama) | model name |
| `PRMAP_LLM_BASE_URL` | `http://127.0.0.1:11434` (ollama) | endpoint; required for `openai-compatible` (e.g. `https://api.openai.com/v1`) |
| `PRMAP_LLM_API_KEY` | — | hosted key (read from env, never logged) |
| `PRMAP_ENRICH_CONCURRENCY` | `4` | parallel provider calls |
| `PRMAP_LLM_TIMEOUT_MS` | `60000` | per-call timeout |

The `openai-compatible` provider works with OpenAI, Groq, Together, OpenRouter, and a remote
Ollama `/v1` endpoint — anything that speaks the OpenAI chat-completions API.

## Standalone (no agent)

From inside a checkout of the PR's repository, with `gh` authenticated:

```
node "$PRMAP_HOME/pr-map-plugin/dist/pr-map.js" <pr-url-or-number>
```

This runs the whole pipeline — graph → enrich → merge → dashboard — and opens the browser. You can
also run the stages individually: `cli.js <ref> <repoRoot>`, then `enrich.js <dataDir>`, then
`merge.js <dataDir>`, then `server.js <dataDir>`.

## Codex

1. Copy the skill so Codex discovers it:
   ```
   cp -r "$PRMAP_HOME/integrations/codex/skills/pr-map" ~/.codex/skills/
   ```
2. Optionally add the snippet in `integrations/codex/AGENTS.md` to your `~/.codex/AGENTS.md`.
3. In Codex, ask to review a PR (or invoke the `pr-map` skill); it runs the standalone pipeline.

## Gemini CLI

Install the extension (it bundles the `GEMINI.md` context and a `/pr-map` command):

```
gemini extensions install "$PRMAP_HOME/integrations/gemini"
```

Then run `/pr-map <pr-url-or-number>` in Gemini CLI.

## The rule (every runtime)

The AI enrichment is a set of review suggestions to guide a human, never verified facts. No wrapper
submits a review on your behalf — submitting (Approve / Request changes / Comment) is always an
explicit action you take in the dashboard.
