# pr-map (AGENTS.md snippet)

Add this to your project or `~/.codex/AGENTS.md` so Codex knows how to run pr-map.

---

## Reviewing a pull request with pr-map

To review or map a GitHub PR, run the standalone pipeline:

```
node "$PRMAP_HOME/pr-map-plugin/dist/pr-map.js" <pr-url-or-number>
```

- `$PRMAP_HOME` is the path to the pr-map repository clone.
- Run it from inside a checkout of the PR's repository, with `gh auth status` passing.
- It builds a file graph, enriches each file with the configured LLM provider (local Ollama by
  default — see `integrations/README.md` for `PRMAP_LLM_*`), merges, and opens a browser dashboard.
- The AI notes are review suggestions, not verdicts. Do not submit a review on the user's behalf;
  the human submits it in the dashboard.
