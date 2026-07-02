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
  headSha: string;
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

export interface ExistingConversationComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

export interface ReviewThreadComment {
  id: number | null;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: ReviewThreadComment[];
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export type ChecksState = 'success' | 'failure' | 'pending';

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string;
  url: string | null;
}

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
