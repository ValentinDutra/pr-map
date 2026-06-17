---
name: pr-map
description: Use when reviewing a GitHub pull request and you want to see how its files connect (imports, references, and why) as an interactive mind map and review it — inline/general comments plus a verdict — from the browser. Triggers on review PR, map this PR, visualize a pull request, how do these files connect.
---

# /pr-map

Turn a GitHub Pull Request into an interactive mind map and review it from the browser.
The pipeline is deterministic for nodes and static edges; you (the agent) add the
plain-language "why" and any semantic edges; then a local web dashboard lets the user
comment and submit a review to GitHub via `gh`.

## Prerequisites (check first, stop with a clear message if unmet)

1. `gh auth status` must succeed (review actions and PR data use the authenticated `gh`).
2. The current directory must be a checkout of the PR's repository (`gh` resolves
   `{owner}/{repo}` from the git remote, and incoming-edge detection runs `git grep`).
3. `PR_MAP_HOME` must point at the pr-map checkout (default:
   `/Users/valentindutraclaudio/Documents/Projects/Personal/pr-map`). The first time, run
   `npm install` there and build the dashboard once:
   `npm --prefix "$PR_MAP_HOME" install` and `npm --prefix "$PR_MAP_HOME/dashboard" install && npm --prefix "$PR_MAP_HOME/dashboard" run build`.

## Steps

1. **Resolve the PR ref.** Use the argument the user passed (a PR number or URL). If none,
   default to the current branch's PR (`gh pr view --json number,url`). Confirm the PR exists.

2. **Check out the PR** so its files (including newly added ones) are on disk for the static
   scan: `gh pr checkout <number>` (skip if already on that branch).

3. **Build the static graph** (deterministic — nodes + static edges + one-hop neighbors):
   ```
   npx tsx "$PR_MAP_HOME/src/cli.ts" <ref> "$(pwd)"
   ```
   It prints a JSON line: `{ dataDir, graphPath, prNumber, title, nodeCount, edgeCount }`.
   Capture `dataDir` and `graphPath`.

4. **Enrich `graph.json` in place** — this is the LLM step; do it yourself. Read the PR
   description (`gh pr view <ref> --json title,body`), skim the diffs/files, and read the
   static graph at `graphPath`. Then edit `graphPath`:
   - Give every node a concise `summary` (what the file does and its role in this PR).
   - Give every edge a `why` in plain language (why these two files are connected).
   - Add semantic links the static pass missed as NEW edges with `origin: "llm"`,
     `kind: "semantic"`, an honest `confidence` between 0 and 1, a `why`, and a unique `id`.
   - NEVER edit or remove edges whose `origin` is `"static"` — those are the certain ones.
   - When you are unsure a link is real, say so in the `why` and keep `confidence` low.
   - Keep the file valid JSON matching the contract below.

5. **Open the dashboard:**
   ```
   npx tsx "$PR_MAP_HOME/src/server.ts" "<dataDir>"
   ```
   It serves the graph and opens the browser. From there the user explores the graph,
   reads each file's diff, writes inline (click a diff line) and general comments, replies
   to threads, and submits a verdict (Approve / Request changes / Comment). All review
   actions post to GitHub through `gh`. Submitting is an explicit user action in the UI —
   do not submit on the user's behalf.

## graph.json contract (mirror of `src/types.ts`)

- `meta`: `{ owner, repo, number, title, description, author, baseRef, headRef }`
- `nodes[]`: `{ id, path, language, inPr, status?, additions?, deletions?, patch?, summary? }`
  - `id` and `path` are the repo-relative file path. `inPr: false` marks a one-hop neighbor
    (a file not changed in this PR but connected to one that was). `summary` is yours to fill.
- `edges[]`: `{ id, source, target, kind, direction, origin, confidence, why? }`
  - `source`/`target` are node ids. `kind` is `import | reference | semantic`.
  - `direction` is `outgoing | incoming`. `origin` is `static | llm`. `confidence` is 0–1.
  - `why` is yours to fill. Add only `origin: "llm"` edges; never touch `origin: "static"` ones.
- `generatedAt`: ISO timestamp (already set by the builder).

## Notes

- Static edges currently cover JS/TS and Python imports. For other languages the graph may
  show isolated nodes; lean on `origin: "llm"` semantic edges (clearly flagged) to connect them.
- `graph.json`, `raw.json`, and `pending-review.json` live under
  `<repo>/.pr-map/<owner>-<repo>-<number>/` (gitignore that path in the target repo).
