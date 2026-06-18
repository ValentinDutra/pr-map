// Mirrors the PrGraph contract from ../../src/types.ts. Kept as a separate copy so
// the dashboard does not cross the Node package boundary at build time.

export type NodeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface NodeInsights {
  risks: string[];
  suspectedBugs: string[];
  testsToCheck: string[];
  impact: string;
}
export type EdgeKind = 'import' | 'reference' | 'semantic';
export type EdgeDirection = 'outgoing' | 'incoming';
export type EdgeOrigin = 'static' | 'llm';

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

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  direction: EdgeDirection;
  origin: EdgeOrigin;
  confidence: number;
  why?: string;
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
}

export interface PrGraph {
  meta: PrMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
  hiddenNeighborCount: number;
}

export type CommentSide = 'LEFT' | 'RIGHT';
export type CommentScope = 'line' | 'file';
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

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

export interface ExistingDiscussion {
  reviewComments: ExistingReviewComment[];
  conversationComments: ExistingConversationComment[];
}

// The overall CI verdict for the PR's head commit, rolled up across every check.
export type ChecksState = 'success' | 'failure' | 'pending';

// A single CI check on the PR's head commit (GitHub Actions, App checks, or legacy statuses).
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string;
  url: string | null;
}

// All checks on the PR's head commit plus the rolled-up overall verdict (read-only).
export interface ChecksSummary {
  state: ChecksState;
  checks: CheckRun[];
}
