import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RawPr, workingDirKey } from './fetch-pr.js';
import type { GraphEdge, GraphNode, PrGraph } from './types.js';
import { findRule } from './import-rules.js';
import { type Result, ok, err } from './result.js';

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
    patch: file.patch,
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

export type GitGrep = (pattern: string) => string[];
export type ReadContent = (path: string) => string | undefined;

function importPatternsFor(prPath: string): string[] {
  const withoutExtension = prPath.replace(/\.[^./]+$/, '');
  const baseName = withoutExtension.slice(withoutExtension.lastIndexOf('/') + 1);
  const dottedModule = withoutExtension.replace(/\//g, '.');
  return [...new Set([withoutExtension, baseName, dottedModule])].filter(
    (pattern) => pattern.length > 0,
  );
}

export function addIncomingEdges(
  nodes: GraphNode[],
  prFilePaths: string[],
  repoFiles: Set<string>,
  gitGrep: GitGrep,
  readContent: ReadContent,
): GraphParts {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map<string, GraphEdge>();
  const prFileSet = new Set(prFilePaths);

  for (const prPath of prFilePaths) {
    const candidates = new Set<string>();
    for (const pattern of importPatternsFor(prPath)) {
      for (const match of gitGrep(pattern)) {
        candidates.add(match);
      }
    }
    for (const candidatePath of candidates) {
      if (candidatePath === prPath || prFileSet.has(candidatePath)) continue;
      const rule = findRule(candidatePath);
      if (!rule) continue;
      const content = readContent(candidatePath);
      if (content === undefined) continue;
      const importsThePrFile = rule
        .extractSpecifiers(content)
        .some((specifier) => rule.resolve(specifier, candidatePath, repoFiles).includes(prPath));
      if (!importsThePrFile) continue;
      ensureNeighbor(nodesById, candidatePath);
      addEdge(edgesById, {
        source: candidatePath,
        target: prPath,
        kind: 'import',
        direction: 'incoming',
        origin: 'static',
        confidence: 1,
      });
    }
  }

  return { nodes: [...nodesById.values()], edges: [...edgesById.values()] };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function assembleGraph(
  rawPr: RawPr,
  repoFiles: Set<string>,
  gitGrep: GitGrep,
  readContent: ReadContent,
  generatedAt: string,
): PrGraph {
  const prNodes = buildNodes(rawPr);
  const outgoing = addOutgoingEdges(prNodes, rawPr, repoFiles);
  const prFilePaths = rawPr.files.map((file) => file.path);
  const incoming = addIncomingEdges(
    outgoing.nodes,
    prFilePaths,
    repoFiles,
    gitGrep,
    readContent,
  );
  return {
    meta: rawPr.meta,
    nodes: dedupeById([...outgoing.nodes, ...incoming.nodes]),
    edges: dedupeById([...outgoing.edges, ...incoming.edges]),
    generatedAt,
  };
}

export interface GraphWriteError {
  message: string;
}

export async function writeGraph(
  graph: PrGraph,
  workingDir: string,
): Promise<Result<string, GraphWriteError>> {
  const directory = join(workingDir, '.pr-map', workingDirKey(graph.meta));
  try {
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, 'graph.json');
    await writeFile(filePath, JSON.stringify(graph, null, 2), 'utf8');
    return ok(filePath);
  } catch (error) {
    return err({ message: `Failed to write graph.json: ${(error as Error).message}` });
  }
}
