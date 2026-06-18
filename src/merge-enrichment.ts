import { readFile, readdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Result, ok, err } from './result.js';
import { detectLanguage } from './languages.js';
import type { GraphEdge, NodeInsights, PrGraph } from './types.js';

export interface EnrichmentResult {
  path: string;
  summary?: string;
  edgeWhys?: Record<string, string>;
  insights?: NodeInsights;
  semanticEdges?: { target: string; confidence: number; why: string }[];
}

// Pure merge: applies subagent enrichment onto a static graph without mutating the input.
// Adds `why`/`summary`/`insights` and `origin: "llm"` semantic edges; never removes or
// alters existing `origin: "static"` edges beyond attaching a `why`.
export function mergeEnrichment(graph: PrGraph, results: EnrichmentResult[]): PrGraph {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, { ...node }]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, { ...edge }]));

  for (const result of results) {
    const node = nodesById.get(result.path);
    if (node) {
      if (result.summary !== undefined) node.summary = result.summary;
      if (result.insights !== undefined) node.insights = result.insights;
    }

    for (const [edgeId, why] of Object.entries(result.edgeWhys ?? {})) {
      const edge = edgesById.get(edgeId);
      if (edge) edge.why = why;
    }

    for (const semantic of result.semanticEdges ?? []) {
      if (semantic.target === result.path) continue;
      const id = `${result.path}->${semantic.target}:semantic:outgoing`;
      if (edgesById.has(id)) continue;
      // The semantic target may be a file the static scan never added (e.g. an alias import
      // it could not resolve). Add it as a neighbor node so the edge actually renders.
      if (!nodesById.has(semantic.target)) {
        nodesById.set(semantic.target, {
          id: semantic.target,
          path: semantic.target,
          language: detectLanguage(semantic.target),
          inPr: false,
        });
      }
      // Clamp the model-provided confidence into [0, 1] (defaulting a missing/NaN value to a
      // neutral 0.5) so the dashboard never renders a nonsensical percentage.
      const confidence = Number.isFinite(semantic.confidence)
        ? Math.min(1, Math.max(0, semantic.confidence))
        : 0.5;
      const edge: GraphEdge = {
        id,
        source: result.path,
        target: semantic.target,
        kind: 'semantic',
        direction: 'outgoing',
        origin: 'llm',
        confidence,
        why: semantic.why,
      };
      edgesById.set(id, edge);
    }
  }

  return {
    ...graph,
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
  };
}

function flattenResults(parsed: unknown): EnrichmentResult[] {
  if (Array.isArray(parsed)) return parsed as EnrichmentResult[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown }).files)) {
    return (parsed as { files: EnrichmentResult[] }).files;
  }
  if (parsed && typeof parsed === 'object' && 'path' in (parsed as object)) {
    return [parsed as EnrichmentResult];
  }
  return [];
}

export async function mergeEnrichmentFromDir(
  dataDir: string,
): Promise<Result<{ graphPath: string; applied: number }, { message: string }>> {
  const graphPath = join(dataDir, 'graph.json');
  let graph: PrGraph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf8')) as PrGraph;
  } catch (error) {
    return err({ message: `Could not read ${graphPath}: ${(error as Error).message}` });
  }

  const enrichmentDir = join(dataDir, 'enrichment');
  let files: string[] = [];
  try {
    files = (await readdir(enrichmentDir)).filter((name) => name.endsWith('.json'));
  } catch {
    files = [];
  }

  const results: EnrichmentResult[] = [];
  for (const name of files) {
    try {
      results.push(...flattenResults(JSON.parse(await readFile(join(enrichmentDir, name), 'utf8'))));
    } catch {
      // Skip a malformed enrichment file rather than failing the whole merge.
      console.warn(`pr-map: skipping unparseable enrichment file ${name}`);
    }
  }

  try {
    await writeFile(graphPath, JSON.stringify(mergeEnrichment(graph, results), null, 2), 'utf8');
  } catch (error) {
    return err({ message: `Could not write ${graphPath}: ${(error as Error).message}` });
  }
  return ok({ graphPath, applied: results.length });
}

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: merge.js <dataDir>');
    process.exit(1);
  }
  const result = await mergeEnrichmentFromDir(dataDir);
  if (!result.ok) {
    console.error(`pr-map: ${result.error.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result.value));
}

// Run as a CLI only when invoked directly (not when imported by tests). realpath handles
// macOS /var -> /private symlinks; pathToFileURL handles encoding.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
