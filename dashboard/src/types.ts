// Mirrors the PrGraph contract from ../../src/types.ts. Kept as a separate copy so
// the dashboard does not cross the Node package boundary at build time.

export type NodeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
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
