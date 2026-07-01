export type NodeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface NodeInsights {
  risks: string[];
  suspectedBugs: string[];
  testsToCheck: string[];
  impact: string;
}

export interface GraphNode {
  id: string;
  path: string;
  language: string;
  inPr: boolean;
  status?: NodeStatus;
  additions?: number;
  deletions?: number;
  patch?: string;
  summary?: string;
  insights?: NodeInsights;
}

export type EdgeKind = 'import' | 'reference' | 'semantic';
export type EdgeDirection = 'outgoing' | 'incoming';
export type EdgeOrigin = 'static' | 'llm';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  direction: EdgeDirection;
  origin: EdgeOrigin;
  confidence: number;
  why?: string;
  // The changed symbol crossing this edge that made the neighbor affected (static edges only).
  affectedSymbol?: string;
}

export interface PrMeta {
  owner: string;
  repo: string;
  number: number;
  title: string;
  description: string;
  author: string;
  baseRef: string;
  headRef: string;
  // Immutable head commit SHA. Preferred over headRef (a branch name) for fetching file
  // content, since the SHA still resolves after the branch is deleted or force-pushed.
  headSha: string;
}

export interface PrGraph {
  meta: PrMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
  // Number of one-hop importers hidden because they use no symbol the diff changed.
  hiddenNeighborCount: number;
}

export type CommentSide = 'LEFT' | 'RIGHT';
export type CommentScope = 'line' | 'file';

export interface PendingComment {
  id: string;
  scope: CommentScope;
  path: string;
  line?: number;
  startLine?: number;
  side?: CommentSide;
  startSide?: CommentSide;
  body: string;
  inReplyTo?: number;
}

export interface ReviewState {
  prNumber: number;
  comments: PendingComment[];
  // The review summary body (the PR-level comment) submitted together with the verdict.
  summaryBody?: string;
}

// A line-scoped review comment already posted to the PR by any reviewer (read-only).
export interface ExistingReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: CommentSide;
  body: string;
  author: string;
  createdAt: string;
  inReplyToId: number | null;
}

// A PR-level (Conversation tab) comment already posted to the PR by any reviewer (read-only).
export interface ExistingConversationComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

// A single comment inside a review thread, normalized from the GraphQL reviewThreads query.
export interface ReviewThreadComment {
  // The REST comment database id (GraphQL exposes it as databaseId); null when unavailable.
  id: number | null;
  author: string;
  body: string;
  createdAt: string;
}

// A review-comment thread on the PR, with its resolved state and the GraphQL node id needed to
// resolve/unresolve it. Threads are the GraphQL-native grouping the REST comments list lacks.
export interface ReviewThread {
  // The GraphQL node id of the thread (passed to the resolve/unresolve mutations).
  id: string;
  isResolved: boolean;
  path: string;
  // The new-file line the thread is anchored to, from the first comment's line ?? originalLine.
  line: number | null;
  comments: ReviewThreadComment[];
}

// A single commit on the PR, normalized from the pulls/{number}/commits endpoint (read-only).
export interface CommitInfo {
  sha: string;
  // The abbreviated SHA shown in the UI; first 7 characters of sha.
  shortSha: string;
  // The first line of the commit message (the subject).
  message: string;
  author: string;
  date: string;
  url: string;
}

// The overall CI verdict for the PR's head commit, rolled up across every check.
export type ChecksState = 'success' | 'failure' | 'pending';

// A single CI check on the PR's head commit, normalized from both the check-runs API
// (GitHub Actions, App checks) and the legacy combined-status API (commit statuses).
export interface CheckRun {
  name: string;
  // The check-runs lifecycle (queued | in_progress | completed); legacy statuses report 'completed'.
  status: string;
  // The check-runs outcome (success | failure | …) or the legacy status state (success | failure | pending).
  conclusion: string;
  url: string | null;
}

// All checks on the PR's head commit plus the rolled-up overall verdict (read-only).
export interface ChecksSummary {
  state: ChecksState;
  checks: CheckRun[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  path: string;
}
