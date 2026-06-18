# pr-map (Gemini CLI extension)

pr-map turns a GitHub pull request into an interactive map of the changed files plus AI review
insights, opened in a local browser dashboard where the human reads diffs and submits a review.

## How to run it

When the user asks to review or map a PR, run the standalone pipeline:

```
node "$PRMAP_HOME/pr-map-plugin/dist/pr-map.js" <pr-url-or-number>
```

- `$PRMAP_HOME` is the path to the pr-map repository clone (set it in your shell).
- The current directory must be a checkout of the PR's repository, and `gh auth status` must succeed.
- The pipeline builds the static graph, enriches each file with the configured LLM provider,
  merges the result, and opens the dashboard.

## LLM provider

Enrichment uses whatever provider the `PRMAP_LLM_*` environment variables select (local Ollama by
default). See the repository's `integrations/README.md` for the variable table.

## The rule

pr-map's AI notes are review **suggestions** to guide the human, never verified facts. Never
submit a review (Approve / Request changes / Comment) on the user's behalf — submitting is an
explicit action the human takes in the dashboard.
