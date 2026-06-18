import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Result, ok, err, isOk } from './result.js';
import type { GraphEdge, GraphNode, PrGraph } from './types.js';
import type { EnrichmentResult } from './merge-enrichment.js';
import { type LlmProvider, type ProviderEnv, selectProvider } from './llm-provider.js';

// Portable AI enrichment: the deterministic counterpart to Claude's pr-file-analyst subagents.
// It builds the same per-file prompt from the static graph, calls a configured LLM provider,
// and writes enrichment/<i>.json files in the EnrichmentResult shape that merge.js consumes —
// so Codex, Gemini, or a standalone run get the same enrichment Claude produces via subagents.

const ENRICHMENT_CONTRACT = `Return ONLY a JSON object (no prose, no markdown fences) of the form:
{
  "files": [
    {
      "path": "<repo-relative path, exactly as given below>",
      "summary": "<what the file does and its role in this PR>",
      "edgeWhys": { "<edgeId>": "<why these two files are connected>" },
      "insights": { "risks": [], "suspectedBugs": [], "testsToCheck": [], "impact": "<one line>" },
      "semanticEdges": [ { "target": "<repo-relative path>", "confidence": 0.0, "why": "<why>" } ]
    }
  ]
}
Include exactly one entry per file listed. Use the exact edgeId values given. Omit semanticEdges
(or use []) when there are none. These are review SUGGESTIONS to guide a human reviewer, not
verified facts; the human makes the real decisions.`;

function edgesTouching(graph: PrGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

// Build a single prompt covering every file in the batch, from the same inputs pr-file-analyst
// receives: each file's diff, the edges touching it, and a one-line note about each neighbor.
export function buildPrompt(nodes: GraphNode[], graph: PrGraph): string {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const sections = nodes.map((node) => {
    const edgeLines = edgesTouching(graph, node.id).map((edge) => {
      const otherId = edge.source === node.id ? edge.target : edge.source;
      const direction = edge.source === node.id ? 'imports' : 'imported by';
      const neighborSummary = nodesById.get(otherId)?.summary;
      const note = neighborSummary ? ` — ${neighborSummary}` : '';
      return `  - edgeId "${edge.id}": ${direction} ${otherId} (${edge.kind}, ${edge.origin})${note}`;
    });
    return [
      `### File: ${node.path} (${node.language})`,
      node.patch ? `Diff:\n${node.patch}` : '(no diff available)',
      edgeLines.length > 0
        ? `Edges touching this file:\n${edgeLines.join('\n')}`
        : 'No edges touch this file.',
    ].join('\n');
  });

  return [
    `You are reviewing files changed in GitHub pull request #${graph.meta.number}: "${graph.meta.title}".`,
    graph.meta.description ? `PR description:\n${graph.meta.description}` : '',
    'Analyze each file below and produce review enrichment for it.',
    sections.join('\n\n'),
    ENRICHMENT_CONTRACT,
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?/gi, '');
}

// Extract the first balanced-looking JSON value (object or array) from text that may have prose
// around it — small models often wrap JSON in explanation despite instructions.
function extractJson(text: string): string | null {
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  let start = -1;
  if (firstObject === -1) start = firstArray;
  else if (firstArray === -1) start = firstObject;
  else start = Math.min(firstObject, firstArray);
  if (start === -1) return null;
  const close = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

// Normalize a parsed response to a flat list: a bare object, a `{ files: [...] }` wrapper, or an
// array. (Kept local so this entry's bundle never pulls in merge-enrichment's CLI side effects.)
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

// Tolerant parse: strip code fences, isolate the JSON, parse, and normalize to a flat list of
// EnrichmentResult (handles a bare object, a `{ files: [...] }` wrapper, or an array).
export function parseEnrichmentResponse(text: string): Result<EnrichmentResult[], { message: string }> {
  const jsonText = extractJson(stripCodeFences(text).trim());
  if (jsonText === null) return err({ message: 'no JSON found in model response' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return err({ message: `invalid JSON in model response: ${(error as Error).message}` });
  }
  return ok(flattenResults(parsed));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await task(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export interface EnrichDeps {
  provider: LlmProvider;
  concurrency?: number;
  log?: (message: string) => void;
}

// Drive enrichment over the PR's changed files. Batches like the skill (<=10 files -> one per
// prompt; >10 -> batches of ~5), runs with bounded concurrency, and fails open per batch: a
// provider or parse failure skips those files (logged) rather than aborting the whole run.
export async function enrichGraph(graph: PrGraph, deps: EnrichDeps): Promise<EnrichmentResult[]> {
  const changedNodes = graph.nodes.filter((node) => node.inPr);
  if (changedNodes.length === 0) return [];
  const batchSize = changedNodes.length <= 10 ? 1 : 5;
  const batches = chunk(changedNodes, batchSize);

  const perBatch = await mapWithConcurrency(batches, deps.concurrency ?? 4, async (batch) => {
    const label = batch.map((node) => node.path).join(', ');
    const completion = await deps.provider.complete(buildPrompt(batch, graph));
    if (!isOk(completion)) {
      deps.log?.(`enrichment failed for ${label}: ${completion.error.message}`);
      return [];
    }
    const parsed = parseEnrichmentResponse(completion.value);
    if (!isOk(parsed)) {
      deps.log?.(`could not parse enrichment for ${label}: ${parsed.error.message}`);
      return [];
    }
    return parsed.value;
  });

  return perBatch.flat();
}

export type EnrichEnv = ProviderEnv & { PRMAP_ENRICH_CONCURRENCY?: string };

export async function enrichFromDir(
  dataDir: string,
  env: EnrichEnv,
): Promise<Result<{ enrichmentDir: string; written: number }, { message: string }>> {
  const graphPath = join(dataDir, 'graph.json');
  let graph: PrGraph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf8')) as PrGraph;
  } catch (error) {
    return err({ message: `could not read ${graphPath}: ${(error as Error).message}` });
  }

  const providerResult = selectProvider(env);
  if (!isOk(providerResult)) return err({ message: providerResult.error.message });

  const parsedConcurrency = env.PRMAP_ENRICH_CONCURRENCY
    ? Number.parseInt(env.PRMAP_ENRICH_CONCURRENCY, 10)
    : NaN;
  const concurrency = Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
    ? parsedConcurrency
    : 4;

  const results = await enrichGraph(graph, {
    provider: providerResult.value,
    concurrency,
    log: (message) => console.warn(`pr-map: ${message}`),
  });

  const enrichmentDir = join(dataDir, 'enrichment');
  try {
    await mkdir(enrichmentDir, { recursive: true });
    for (let index = 0; index < results.length; index += 1) {
      const filePath = join(enrichmentDir, `${index}.json`);
      await writeFile(filePath, JSON.stringify(results[index], null, 2), 'utf8');
    }
  } catch (error) {
    return err({ message: `could not write enrichment files: ${(error as Error).message}` });
  }

  return ok({ enrichmentDir, written: results.length });
}

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: enrich.js <dataDir>');
    process.exit(1);
  }
  const result = await enrichFromDir(resolve(dataDir), process.env);
  if (!isOk(result)) {
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
