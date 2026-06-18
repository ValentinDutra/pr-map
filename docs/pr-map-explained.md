# pr-map, explained (for me)

A plain-language note on what this tool is, what it does, and how it works.

## The problem it solves

Reviewing a pull request (a "PR" — a proposed set of code changes someone wants to merge)
on GitHub is hard once it touches more than a few files. GitHub shows you a long flat list of
diffs. You lose the big picture: which files depend on which, what the risky parts are, what a
change might break somewhere else. You end up scrolling, holding the whole structure in your
head.

pr-map fixes that by turning a PR into a **map** plus a **review workspace** in your browser.

## What it does, in one sentence

It takes a PR, draws a graph of the files it changes and how they connect, adds short
AI-written notes about each file (summary, risks, things to check), and opens a local web
dashboard where you read the diffs and leave your review — which it posts back to GitHub for you.

## What happens when you run it (step by step)

1. **You point it at a PR** — by number (`42`) or URL. It checks that PR out so all the
   changed files, including newly added ones, are on your disk.
2. **It builds the graph.** Each changed file becomes a box (a "node"). It scans the code for
   imports to draw lines ("edges") between files that use each other. It also pulls in nearby
   unchanged files that depend on the changed ones, so you can see the "blast radius" — what
   else might be affected.
3. **It adds AI insights ("enrichment").** For each file it produces a plain-language summary,
   the reason two files are connected, and review hints: risks, suspected bugs, tests to check,
   and the impact. It can also guess connections the plain import-scan missed (those are marked
   as AI-suggested, drawn as dashed purple lines).
4. **It opens the dashboard** in your browser, and you review.

## What you see in the dashboard

- **The graph** — all the changed files and their one-hop neighbors. Solid grey line = a real
  import the scanner found. Dashed purple line = a connection the AI inferred. Click a file to
  highlight its connections and trace the flow.
- **The diff** — GitHub-style, with old/new line numbers. Click a line (or drag across several)
  to comment. You can comment on a single line, a range, a whole file, or the PR overall.
- **The existing conversation** — comments already on the PR (read-only).
- **CI / checks status** — a badge showing whether the automated tests on GitHub pass.
- **The commit list** — every commit in the PR, each linking to GitHub.
- **Viewed tracking** — mark files as "viewed" to track your progress; it remembers per PR.
- **Submit** — Approve, Request changes, or Comment. This is the only thing that writes to
  GitHub, and only when you click it.

## The one rule that matters

**The AI only suggests. You decide.** Every AI note is framed as a hint to guide your
attention — not a verdict, not verified truth. The tool never approves, never posts a comment,
and never makes a decision on your behalf. The real review is always done by you, the human.

## How it's built (under the hood, simply)

The whole thing is four stages run in order:

```
build the graph  →  add AI insights  →  merge them together  →  open the dashboard
```

- Three of those four stages are plain, predictable Node scripts (no AI): building the graph,
  merging, and serving the dashboard.
- Only the "add AI insights" stage uses a language model.
- All the talking to GitHub (reading the PR, posting your review) goes through the `gh`
  command-line tool you're already logged into — so there are no API keys to manage.

## Where it runs

- **Today:** it's a plugin for **Claude Code**. You type `/pr-map 42` and Claude does the AI
  insight step itself.
- **Planned (issue #7, designed, not yet built):** make the AI step a swappable model so the
  exact same tool runs under **any** coding agent (Codex, Gemini CLI) or **standalone with no
  agent at all** — using a free local model (Ollama) by default, or a hosted one if you prefer.
  After that, "the insights are done by Claude" becomes "the insights are done by whatever model
  you choose," which is what makes it portable.

## Mini-glossary

- **PR (pull request):** a proposed code change on GitHub, waiting to be reviewed and merged.
- **Node / edge:** a box (file) and a line (a connection between two files) in the graph.
- **Import scan / static edge:** finding connections by reading `import` statements in the
  code — exact, not guessed.
- **Enrichment:** the AI-written notes added to each file and connection.
- **AI-suggested (llm) edge:** a connection the model inferred that the import scan didn't find;
  drawn dashed purple, always a suggestion.
- **gh:** GitHub's official command-line tool; the tool uses your existing login through it.
- **Dashboard:** the local web page (in your browser) where you actually do the review.
- **Ollama:** software that runs an AI model locally on your own machine, for free, no API key.
