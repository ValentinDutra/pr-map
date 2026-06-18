# pr-map v3 — Symbol-level neighbor filtering, GitHub-faithful comments, theming

Date: 2026-06-17

## Context

pr-map turns a GitHub PR into an interactive mind map with per-file review insights and lets the
user review from the browser. v2 ships as an installable Claude Code plugin (deterministic static
graph + `pr-file-analyst` subagents for enrichment + dashboard). After a live run against
`srodriguez-lefebre/wallet-web-personal#1`, three gaps surfaced:

1. The one-hop neighbor set is too noisy: every file that imports a changed file is shown, even
   when it does not use any symbol the diff actually touched (e.g. `api/accounts` imports the
   repository but only calls account functions, untouched by a debt-only change).
2. The UI is functional but not intuitive and has no dark/light theme.
3. The comment model has only two scopes (inline vs "general", with general folded into the review
   body). GitHub has three real scopes — line, file, PR — plus verdicts; the tool should mirror them.

## Goals

- Show only neighbors genuinely affected by the change, decided deterministically (symbol-level).
- Make the comment model faithful to GitHub: line (incl. multi-line range), file, and PR scopes,
  with Approve / Request changes / Comment verdicts, plus standalone conversation comments.
- Add a dark/light theme that follows the OS by default, with a manual, persisted toggle, and a
  more intuitive layout.

## Non-goals

- The LLM's role does not change: it explains connections and produces insights; it does NOT decide
  graph membership. Membership stays deterministic and reproducible.
- Symbol extraction covers JS/TS and Python only (same coverage as `import-rules.ts`).
- No GitHub "suggestion" blocks, no reactions, no thread-resolution UI.
- No change to plugin packaging, subagents, or the SessionEnd hook.

## Design

### 1. Symbol-level neighbor filtering (deterministic, build-time)

**Inclusion rule (symmetric):** a non-changed neighbor file is kept only if the PR's changed lines
reference a symbol that crosses the edge to it.

- **New module `src/changed-symbols.ts`** (dependency-injected like the rest). Given a changed
  file's unified diff `patch` (and its head content when `status === 'added'`), return the set of
  exported symbol names the diff touched. Signals:
  - Each hunk header `@@ -a,b +c,d @@ <context>` — `<context>` names the enclosing declaration
    (e.g. `export async function updateDebt`).
  - Exported declarations on added/removed lines: `export function|const|class|type|interface X`,
    `export default`, `export { X }`; Python `def X` / `class X`.
  - For an `added` file: all exports parsed from head content (everything is new).
  - Language-aware (JS/TS + Python), mirroring `import-rules.ts`.
- **Dependents (incoming edges):** keep an importer only if it imports/uses a symbol in the changed
  file's `changedSymbols`. Handle `import { x }`, `import * as ns` (then look for `ns.x` usage),
  and default imports.
- **Dependencies (outgoing edges):** keep a dependency only if a changed line in the changed file
  references a symbol imported from that dependency.
- **Node inclusion:** a neighbor node (`inPr: false`) is included only if it retains ≥1 active edge.
- **Fail-open:** if symbol extraction throws or yields an empty set for a file (parse failure),
  keep that file's neighbors and flag them "symbols undetermined" rather than hiding on uncertainty.
- **UI note:** show a passive count of hidden importers ("N importers with no affected symbols,
  hidden"). No toggle.

This lives in the static build path (`cli.js` → `build-graph.ts`), before enrichment. The graph is
pruned the moment it is first shown; the LLM never affects membership.

### 2. Comment model (GitHub-faithful)

Replace the inline/general split with the three real GitHub scopes, batched as a pending review.

**Types (`src/types.ts` and the dashboard mirror):**

```ts
type CommentScope = 'line' | 'file';
interface PendingComment {
  id: string;
  scope: 'line' | 'file';
  path: string;            // required for both line and file
  line?: number;           // line scope: end line of the comment
  startLine?: number;      // line scope: range start (multi-line)
  side?: 'LEFT' | 'RIGHT';
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
  inReplyTo?: number;
}
interface ReviewState {
  prNumber: number;
  comments: PendingComment[];  // line + file scoped (the pending review's inline comments)
  summaryBody?: string;        // the review body = the PR-level comment, submitted with the verdict
}
```

- **PR-level comment** = the review `summaryBody`, sent with the verdict. It is one body, not a list.
- **Submit review** (`gh api repos/{owner}/{repo}/pulls/{n}/reviews`): `event = APPROVE |
  REQUEST_CHANGES | COMMENT`, `body = summaryBody`, `comments[]` with `path/line/side/start_line/
  start_side`. File-scope comments use `subject_type: file`.
- **Conversation comment** (standalone PR-level, posted immediately, not batched): new endpoint
  `POST /api/review/conversation` → `gh api repos/{owner}/{repo}/issues/{n}/comments`. Mirrors
  GitHub's "Comment" button on the Conversation tab.
- **Reply to a thread:** keep the existing `replyToComment`.

**`src/gh-client.ts` additions:**
- Extend `createReview` to carry `start_line`/`start_side` and file-scope (`subject_type: file`)
  comments.
- `createConversationComment(prNumber, body)`.
- `getHeadSha(prNumber)` — the standalone review-comment endpoint needs `commit_id`.

**`src/review-endpoints.ts` changes:**
- `addComment` takes `scope` + range fields; validate per scope (line needs `path` + `line`; file
  needs `path`; range needs `startLine <= line`).
- `buildSubmission` maps `comments[]` to the reviews payload (line + file) and `summaryBody` to
  `body`.
- New `POST /conversation` handler (immediate issue comment via Result pattern).

**Verification item (resolve in planning, does not change the design):** confirm whether the bulk
`reviews` endpoint accepts `subject_type: file` in `comments[]`, or whether file comments must go
through `POST /pulls/{n}/comments` with `commit_id`. Pick the endpoint accordingly.

### 3. UI / theme

- **Theme:** a provider initialized from `prefers-color-scheme`, persisted to `localStorage`, with a
  header toggle. Tailwind v4 class-based dark mode; every component gets dark variants.
- **Layout:** header (PR title/number, theme toggle, "Finish review" button with a pending-count
  badge) · graph on the left (resizable) · right detail panel with tabs **Diff | Insights |
  Conversation**.
- **GitHub-style diff:** hovering a line shows a "+" to comment on it; range selection (shift-click)
  for multi-line; the file header has a "Comment on file" affordance; pending comments render as
  inline threads.
- **Review tray:** the "Finish review" panel = summary textarea + Approve / Request changes /
  Comment radios + submit. The **Conversation** tab lists and adds standalone PR comments.
- **Edges:** label each edge with the symbol that makes it affected (clearer than the generic
  `kind`).

## Error handling

- Result pattern for all new endpoints; `gh` errors surface to the UI (unchanged behavior).
- Symbol extraction is fail-open: uncertainty keeps neighbors visible, never hides them.

## Testing (minimum, maximum value)

- `changed-symbols`: hunk-header extraction (TS), an `added` file (all exports), Python `def`/`class`.
- Neighbor filtering: a changed file exporting `{X, Y}`; an importer using `X` is kept, one using
  only `Z` is dropped; an outgoing dependency referenced on a changed line is kept.
- `buildSubmission`: the three scopes (line range, file, summary) produce the correct payload shape.
- No new dashboard tests unless a unit genuinely warrants one.

## Files affected

- New: `src/changed-symbols.ts` (+ test).
- Changed: `src/build-graph.ts` (apply filtering), `src/types.ts`, `src/gh-client.ts`,
  `src/review-endpoints.ts`, `src/cli.ts` (wire changed-symbols provider).
- Dashboard: theme provider + toggle, tabbed detail panel, GitHub-style diff comment affordances,
  conversation tab, edge labels, `types.ts` mirror, `review-api.ts`.
- Rebuild the committed plugin bundle (`scripts/build-plugin.mjs`).
