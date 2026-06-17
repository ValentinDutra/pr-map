export type NodeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GraphNode {
  id: string;
  path: string;
  language: string;
  inPr: boolean;
  status?: NodeStatus;
  additions?: number;
  deletions?: number;
  summary?: string;
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
}

export type CommentSide = 'LEFT' | 'RIGHT';

export interface PendingComment {
  id: string;
  path: string;
  line?: number;
  side?: CommentSide;
  body: string;
  inReplyTo?: number;
}

export interface ReviewState {
  prNumber: number;
  comments: PendingComment[];
  generalBody?: string;
}
