import type { RawPr } from './fetch-pr.js';
import type { GraphEdge, GraphNode } from './types.js';
import { findRule } from './import-rules.js';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'css',
  html: 'html',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  sql: 'sql',
};

export function detectLanguage(path: string): string {
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  if (lastDot < 0 || lastDot < lastSlash) return 'unknown';
  const extension = path.slice(lastDot + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? extension;
}

export function buildNodes(rawPr: RawPr): GraphNode[] {
  return rawPr.files.map((file) => ({
    id: file.path,
    path: file.path,
    language: detectLanguage(file.path),
    inPr: true,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    summary: '',
  }));
}

export interface GraphParts {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function ensureNeighbor(nodesById: Map<string, GraphNode>, targetPath: string): void {
  if (nodesById.has(targetPath)) return;
  nodesById.set(targetPath, {
    id: targetPath,
    path: targetPath,
    language: detectLanguage(targetPath),
    inPr: false,
  });
}

function addEdge(
  edgesById: Map<string, GraphEdge>,
  edge: Omit<GraphEdge, 'id'>,
): void {
  const id = `${edge.source}->${edge.target}:${edge.kind}:${edge.direction}`;
  if (!edgesById.has(id)) {
    edgesById.set(id, { id, ...edge });
  }
}

export function addOutgoingEdges(
  nodes: GraphNode[],
  rawPr: RawPr,
  repoFiles: Set<string>,
): GraphParts {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map<string, GraphEdge>();

  for (const file of rawPr.files) {
    if (file.content === undefined) continue;
    const rule = findRule(file.path);
    if (!rule) continue;
    for (const specifier of rule.extractSpecifiers(file.content)) {
      for (const target of rule.resolve(specifier, file.path, repoFiles)) {
        if (target === file.path) continue;
        ensureNeighbor(nodesById, target);
        addEdge(edgesById, {
          source: file.path,
          target,
          kind: 'import',
          direction: 'outgoing',
          origin: 'static',
          confidence: 1,
        });
      }
    }
  }

  return { nodes: [...nodesById.values()], edges: [...edgesById.values()] };
}
