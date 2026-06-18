---
name: pr-map
description: Turn a GitHub pull request into an interactive review map with AI insights, reviewed in the browser. Use when the user asks to review, map, or visualize a PR.
---

# pr-map

Turn a GitHub pull request into an interactive map of the changed files plus AI review insights,
opened in a local browser dashboard where the human reads diffs and submits a review.

## Prerequisites (check first; stop with a clear message if unmet)

1. `gh auth status` succeeds.
2. The current directory is a checkout of the PR's repository.
3. `$PRMAP_HOME` points to the pr-map repository clone.

## Steps

1. Resolve the PR reference from the user's argument (number or URL); default to the current
   branch's PR if none is given.
2. Run the standalone pipeline. It builds the static graph, enriches each changed file with the
   configured LLM provider (local Ollama by default), merges the result, and opens the dashboard:

   ```
   node "$PRMAP_HOME/pr-map-plugin/dist/pr-map.js" <url-or-number>
   ```

3. The dashboard opens in the browser. The human explores the graph, reads each file's diff and
   insights, writes comments, and submits a verdict (Approve / Request changes / Comment).

## The rule

The AI enrichment is a set of review **suggestions** to guide the human, not verified facts. Never
submit a review on the user's behalf — submitting is an explicit action the human takes in the
dashboard.

## Provider configuration

Enrichment uses whatever the `PRMAP_LLM_*` environment variables select. See the repository's
`integrations/README.md` for the variable table.
