# pr-map

Visualize a GitHub Pull Request as an interactive mind map and review it from the browser.

`pr-map` turns the files of a PR into a graph: each changed file is a node, edges
show how files connect (imports, references) and why, and one-hop neighbors (files
that are not changed but talk to the changed ones) are included so you can see the
blast radius. From the same dashboard you can write inline and general comments and
submit a review — approve, request changes, or comment — straight to GitHub via `gh`.

## Why

Reviewing a PR file-by-file hides how the pieces relate. `pr-map` makes the
relationships visible first, then lets you review with that context in hand.

## How it works

A step-by-step pipeline:

1. Changed files become nodes.
2. Static analysis (a lightweight, regex-based import scanner) finds the edges and
   pulls in one-hop neighbors. Files with no relation stay as isolated nodes.
3. The Claude Code agent reads the PR description and diffs to explain *why* each
   relationship exists and to surface semantic links the static pass missed. Every
   edge is tagged with its origin (`static` or `llm`) and a confidence, so you always
   know which connections are certain.

The dashboard is a local web app. Review actions run against GitHub through your
already-authenticated `gh` CLI — no API keys, no token management.

## Status

Pre-implementation. The build plan lives in [`plan.md`](./plan.md) and is executed
task-by-task. Inspired by the core idea of
[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT),
scoped down to PR review.
