import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RawPr, workingDirKey } from './fetch-pr.js';
import type { GraphEdge, GraphNode, PrGraph } from './types.js';
import { findRule } from './import-rules.js';
import {
  extractChangedSymbols as extractChangedSymbolsDefault,
  type ChangedSymbolsInput,
} from './changed-symbols.js';
import { detectLanguage } from './languages.js';
import { type Result, ok, err } from './result.js';

export { detectLanguage } from './languages.js';

const JS_TS_LANGUAGES = new Set(['typescript', 'javascript']);

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
  // Neighbor paths whose only candidate edge was filtered out by symbol-level affectedness.
  droppedNeighbors?: Set<string>;
}

export type ExtractChangedSymbols = (input: ChangedSymbolsInput) => Set<string>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whether `content` references `name` as a standalone identifier (treating word chars
// and `$` as identifier characters, so `repo.createDebt` matches `createDebt`).
function usesIdentifier(content: string, name: string): boolean {
  return new RegExp(`(^|[^\\w$])${escapeRegExp(name)}($|[^\\w$])`).test(content);
}

// The identifiers appearing on the lines a diff actually changed: each hunk header's
// enclosing-declaration context plus every added/removed line.
function wordsOnChangedLines(patch: string): Set<string> {
  const words = new Set<string>();
  for (const rawLine of patch.split('\n')) {
    let text: string | undefined;
    if (rawLine.startsWith('@@')) {
      text = /^@@.*?@@ ?(.*)$/.exec(rawLine)?.[1];
    } else if (rawLine.startsWith('+++') || rawLine.startsWith('---')) {
      text = undefined;
    } else if (rawLine.startsWith('+') || rawLine.startsWith('-')) {
      text = rawLine.slice(1);
    }
    if (!text) continue;
    for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) words.add(word);
  }
  return words;
}

// Local binding names a JS/TS file introduces by importing `specifier`
// (named, aliased, namespace, and default forms).
function localBindingsFor(content: string, specifier: string): string[] {
  // `[^;]` (not `[^;\n]`) so multi-line import statements are matched; the trailing
  // `from '<specifier>'` anchor and the per-statement `;` keep the match from bleeding.
  const statementPattern = new RegExp(
    `import\\s+([^;]*?)\\s+from\\s+['"]${escapeRegExp(specifier)}['"]`,
    'g',
  );
  const bindings: string[] = [];
  let statement: RegExpExecArray | null;
  while ((statement = statementPattern.exec(content)) !== null) {
    const clause = statement[1];
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) bindings.push(namespace[1]);
    const braced = /\{([^}]*)\}/.exec(clause);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const token = part.trim();
        if (!token) continue;
        const alias = /\bas\s+([A-Za-z_$][\w$]*)/.exec(token);
        bindings.push(alias ? alias[1] : token.split(/\s+/)[0]);
      }
    }
    const defaultBinding = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (defaultBinding && defaultBinding[1] !== 'type') bindings.push(defaultBinding[1]);
  }
  return bindings.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
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
  const droppedNeighbors = new Set<string>();
  const prPaths = new Set(rawPr.files.map((file) => file.path));

  for (const file of rawPr.files) {
    if (file.content === undefined) continue;
    const rule = findRule(file.path);
    if (!rule) continue;
    // A dependency is kept only if a changed line of this file references a symbol
    // imported from it. We can only parse those bindings for JS/TS; for other languages,
    // or when no changed-line identifiers are detectable, fail open and keep the edge.
    const changedWords = wordsOnChangedLines(file.patch ?? '');
    const filterOutgoing =
      JS_TS_LANGUAGES.has(detectLanguage(file.path)) && changedWords.size > 0;

    for (const specifier of rule.extractSpecifiers(file.content)) {
      const affectedSymbol = filterOutgoing
        ? localBindingsFor(file.content, specifier).find((name) => changedWords.has(name))
        : undefined;
      for (const target of rule.resolve(specifier, file.path, repoFiles)) {
        if (target === file.path) continue;
        if (filterOutgoing && affectedSymbol === undefined) {
          if (!prPaths.has(target)) droppedNeighbors.add(target);
          continue;
        }
        ensureNeighbor(nodesById, target);
        addEdge(edgesById, {
          source: file.path,
          target,
          kind: 'import',
          direction: 'outgoing',
          origin: 'static',
          confidence: 1,
          ...(affectedSymbol ? { affectedSymbol } : {}),
        });
      }
    }
  }

  return { nodes: [...nodesById.values()], edges: [...edgesById.values()], droppedNeighbors };
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

export interface IncomingTarget {
  path: string;
  previousPath?: string;
}

export function addIncomingEdges(
  nodes: GraphNode[],
  prFiles: IncomingTarget[],
  repoFiles: Set<string>,
  gitGrep: GitGrep,
  readContent: ReadContent,
  changedSymbolsByPath?: Map<string, Set<string>>,
): GraphParts {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map<string, GraphEdge>();
  const droppedNeighbors = new Set<string>();
  const prFileSet = new Set(prFiles.map((file) => file.path));

  for (const prFile of prFiles) {
    const targetPath = prFile.path;
    // A dependent is kept only if it uses a symbol the diff changed in this file. When we
    // have no changed symbols for it (extraction failed/empty), fail open and keep it.
    const changedSymbols = changedSymbolsByPath?.get(targetPath);
    const filterIncoming = changedSymbols !== undefined && changedSymbols.size > 0;
    // A renamed file may still be imported under its old path by files this PR did
    // not touch, so search and confirm against both names.
    const names = prFile.previousPath
      ? [prFile.path, prFile.previousPath]
      : [prFile.path];
    // The old path of a renamed file is no longer on disk, so add it to the set the
    // resolver checks; otherwise an importer still using the old path resolves to nothing.
    const confirmFiles = new Set(repoFiles);
    for (const name of names) confirmFiles.add(name);

    const candidates = new Set<string>();
    for (const name of names) {
      for (const pattern of importPatternsFor(name)) {
        for (const match of gitGrep(pattern)) {
          candidates.add(match);
        }
      }
    }

    for (const candidatePath of candidates) {
      if (candidatePath === targetPath || prFileSet.has(candidatePath)) continue;
      const rule = findRule(candidatePath);
      if (!rule) continue;
      const content = readContent(candidatePath);
      if (content === undefined) continue;
      const resolvedTargets = new Set(
        rule.extractSpecifiers(content).flatMap((specifier) =>
          rule.resolve(specifier, candidatePath, confirmFiles),
        ),
      );
      if (!names.some((name) => resolvedTargets.has(name))) continue;

      let affectedSymbol: string | undefined;
      if (filterIncoming) {
        affectedSymbol = [...changedSymbols].find((symbol) => usesIdentifier(content, symbol));
        if (affectedSymbol === undefined) {
          droppedNeighbors.add(candidatePath);
          continue;
        }
      }

      ensureNeighbor(nodesById, candidatePath);
      addEdge(edgesById, {
        source: candidatePath,
        target: targetPath,
        kind: 'import',
        direction: 'incoming',
        origin: 'static',
        confidence: 1,
        ...(affectedSymbol ? { affectedSymbol } : {}),
      });
    }
  }

  return { nodes: [...nodesById.values()], edges: [...edgesById.values()], droppedNeighbors };
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
  extractChangedSymbols: ExtractChangedSymbols = extractChangedSymbolsDefault,
): PrGraph {
  const prNodes = buildNodes(rawPr);

  const changedSymbolsByPath = new Map<string, Set<string>>();
  for (const file of rawPr.files) {
    changedSymbolsByPath.set(
      file.path,
      extractChangedSymbols({
        patch: file.patch ?? '',
        headContent: file.content,
        language: detectLanguage(file.path),
        status: file.status,
      }),
    );
  }

  const outgoing = addOutgoingEdges(prNodes, rawPr, repoFiles);
  const incoming = addIncomingEdges(
    outgoing.nodes,
    rawPr.files,
    repoFiles,
    gitGrep,
    readContent,
    changedSymbolsByPath,
  );

  const nodes = dedupeById([...outgoing.nodes, ...incoming.nodes]);
  const edges = dedupeById([...outgoing.edges, ...incoming.edges]);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const prPaths = new Set(rawPr.files.map((file) => file.path));
  const dropped = new Set<string>([
    ...(outgoing.droppedNeighbors ?? []),
    ...(incoming.droppedNeighbors ?? []),
  ]);
  let hiddenNeighborCount = 0;
  for (const path of dropped) {
    if (!nodeIds.has(path) && !prPaths.has(path)) hiddenNeighborCount += 1;
  }

  return { meta: rawPr.meta, nodes, edges, generatedAt, hiddenNeighborCount };
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
