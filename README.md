# pr-map

Turn a GitHub pull request into an interactive map and review it from your browser.
`pr-map` is a Claude Code plugin: it builds a graph of the PR's files (nodes are
changed files, edges are imports and references plus the one-hop neighbors they
touch), enriches each file with review insights, and opens a local dashboard where you
read the diff, write comments, and submit a verdict. Every review action posts to
GitHub through your already-authenticated `gh` CLI — no API keys, no token management.

## Prerequisites

- An authenticated `gh` CLI. Run `gh auth status` to confirm; `gh auth login` if not.
- A local checkout of the PR's repository, with the current directory inside it.
  `gh` resolves `{owner}/{repo}` from the git remote, and incoming-edge detection runs
  `git grep` against the working tree.
- Claude Code (the plugin runs as a Claude Code skill).

## Install

The marketplace and the plugin are both named `pr-map`. From a clone of this repo:

```
claude plugin marketplace add .
claude plugin install pr-map@pr-map --scope user
```

`claude plugin marketplace add <dir>` registers the local marketplace defined in
`.claude-plugin/marketplace.json`. `<dir>` is the path to this repository (`.` if you
run the command from the repo root). `--scope user` installs the plugin for your user
so `/pr-map` is available in every project.

The installed plugin is self-contained: its bundled scripts run with plain `node` from
`${CLAUDE_PLUGIN_ROOT}/dist`. There is no `npm install` step for using it.

## Usage

From inside a checkout of the PR's repository, run:

```
/pr-map <url|number>
```

`<url|number>` is the PR URL or its number. With no argument, `pr-map` defaults to the
PR for the current branch.

What the agent does automatically:

1. Resolves the PR reference and checks it out (`gh pr checkout`) so all changed files,
   including added ones, are on disk.
2. Builds the static graph: changed files become nodes, an import scanner finds the
   edges, and one-hop neighbors (unchanged files that talk to the changed ones) are
   pulled in so you can see the blast radius.
3. Dispatches `pr-file-analyst` subagents in parallel to add a plain-language summary
   per file, the "why" behind each connection, review insights (risks, suspected bugs,
   tests to check, impact), and semantic edges the static scan missed. Every AI-added
   edge is tagged `origin: "llm"`; static edges keep `origin: "static"`.
4. Merges the enrichment into the graph and opens the dashboard in your browser.

What you do in the dashboard: explore the graph, read each file's diff and insights,
mark files as viewed, write comments, and submit a verdict. Submitting is always an
explicit action you take in the UI — the agent never submits a review on your behalf.

## Dashboard features

- Symbol-filtered import graph of the changed files and their one-hop neighbors, with
  folder and risk filters and click-to-focus on a node.
- GitHub-style diff with single-line, multi-line range, file, and PR-level comments,
  shown as inline threads.
- The PR's existing conversation (inline review comments and PR-level comments),
  read-only.
- CI/checks status badge for the PR's head commit.
- Commit list for the PR, each linking to GitHub.
- Mark-file-as-viewed progress, persisted per PR across reloads.
- AI enrichment (summaries, insights, inferred edges) clearly framed as suggestions,
  not verdicts.
- Dark and light theme.
- Submit a verdict: Approve, Request changes, or Comment.

## Reviewing

Comments have three scopes:

- **Line / range** — click the `+` on a diff line, or drag down the line numbers to
  select a range, then write the comment.
- **File** — a whole-file comment, added from the file's panel.
- **PR** — a general comment on the pull request as a whole.

Comments collect into a pending review. You can delete a pending comment before
submitting, and reply to an existing thread by its GitHub comment id. When you submit a
verdict (Approve / Request changes / Comment), line and file comments post together with
the verdict; PR-level conversation comments and replies post immediately.

You cannot Approve or Request changes on your own PR — GitHub rejects self-reviews of
that kind. Use Comment instead when reviewing a PR you authored.

## Data and gitignore

`pr-map` writes its working data under the target repository at:

```
.pr-map/<owner>-<repo>-<number>/
```

This holds `graph.json`, `raw.json`, the `enrichment/` directory, and
`pending-review.json`. Add `.pr-map/` to the target repo's `.gitignore` so this
per-PR data is never committed:

```
echo ".pr-map/" >> .gitignore
```

## Troubleshooting

**Dashboard server stopped or closed.** The server is stopped automatically when the
Claude Code session ends (the plugin's `SessionEnd` cleanup hook). To relaunch it
against existing data without rebuilding the graph:

```
node "$CLAUDE_PLUGIN_ROOT/dist/server.js" <dataDir>
```

`<dataDir>` is the `.pr-map/<owner>-<repo>-<number>/` directory printed when the graph
was built. The server listens on `http://localhost:5598` (or the next free port) and
opens the browser.

**`gh` errors when fetching the PR or posting a review.** Run `gh auth status` and
confirm you are authenticated for the right host. Both PR data and review actions go
through `gh`.

**Graph shows isolated nodes.** Static edges are detected by import rules that cover
JavaScript/TypeScript, Python, Go, Java/Kotlin, Ruby, and Rust. Files in other
languages have no static edges and may appear isolated; they rely on AI-suggested edges
(tagged `origin: "llm"`) to connect them.

## Development

For working on `pr-map` itself (not required to use it):

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build:plugin   # build the dashboard and bundle the plugin into pr-map-plugin/
```

`build:plugin` builds `dashboard/` and bundles the runtime into self-contained `node`
scripts under `pr-map-plugin/dist` plus the dashboard under
`pr-map-plugin/dashboard-dist`, which is what the installed plugin runs.

## License

MIT.
