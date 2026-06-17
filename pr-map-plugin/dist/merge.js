import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);

// src/merge-enrichment.ts
import { readFile, readdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// src/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}

// src/merge-enrichment.ts
function mergeEnrichment(graph, results) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, { ...node }]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, { ...edge }]));
  for (const result of results) {
    const node = nodesById.get(result.path);
    if (node) {
      if (result.summary !== void 0) node.summary = result.summary;
      if (result.insights !== void 0) node.insights = result.insights;
    }
    for (const [edgeId, why] of Object.entries(result.edgeWhys ?? {})) {
      const edge = edgesById.get(edgeId);
      if (edge) edge.why = why;
    }
    for (const semantic of result.semanticEdges ?? []) {
      if (semantic.target === result.path) continue;
      const id = `${result.path}->${semantic.target}:semantic:outgoing`;
      if (edgesById.has(id)) continue;
      const edge = {
        id,
        source: result.path,
        target: semantic.target,
        kind: "semantic",
        direction: "outgoing",
        origin: "llm",
        confidence: semantic.confidence,
        why: semantic.why
      };
      edgesById.set(id, edge);
    }
  }
  return {
    ...graph,
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()]
  };
}
function flattenResults(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.files)) {
    return parsed.files;
  }
  if (parsed && typeof parsed === "object" && "path" in parsed) {
    return [parsed];
  }
  return [];
}
async function mergeEnrichmentFromDir(dataDir) {
  const graphPath = join(dataDir, "graph.json");
  let graph;
  try {
    graph = JSON.parse(await readFile(graphPath, "utf8"));
  } catch (error) {
    return err({ message: `Could not read ${graphPath}: ${error.message}` });
  }
  const enrichmentDir = join(dataDir, "enrichment");
  let files = [];
  try {
    files = (await readdir(enrichmentDir)).filter((name) => name.endsWith(".json"));
  } catch {
    files = [];
  }
  const results = [];
  for (const name of files) {
    try {
      results.push(...flattenResults(JSON.parse(await readFile(join(enrichmentDir, name), "utf8"))));
    } catch {
      console.warn(`pr-map: skipping unparseable enrichment file ${name}`);
    }
  }
  try {
    await writeFile(graphPath, JSON.stringify(mergeEnrichment(graph, results), null, 2), "utf8");
  } catch (error) {
    return err({ message: `Could not write ${graphPath}: ${error.message}` });
  }
  return ok({ graphPath, applied: results.length });
}
async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error("usage: merge.js <dataDir>");
    process.exit(1);
  }
  const result = await mergeEnrichmentFromDir(dataDir);
  if (!result.ok) {
    console.error(`pr-map: ${result.error.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result.value));
}
var invokedDirectly = process.argv[1] !== void 0 && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
export {
  mergeEnrichment,
  mergeEnrichmentFromDir
};
