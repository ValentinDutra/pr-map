import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);

// src/enrich.ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}
function isOk(result) {
  return result.ok;
}

// src/retry.ts
async function retry(operation, options) {
  const totalAttempts = Math.max(1, options.attempts);
  let lastResult = await operation();
  let attemptsMade = 1;
  while (!isOk(lastResult) && attemptsMade < totalAttempts) {
    if (options.delayMs > 0) {
      await delay(options.delayMs);
    }
    lastResult = await operation();
    attemptsMade += 1;
  }
  return lastResult;
}
function delay(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}

// src/llm-provider.ts
var DEFAULT_TIMEOUT_MS = 6e4;
var DEFAULT_RETRY = { attempts: 3, delayMs: 500 };
var DEFAULT_OLLAMA_MODEL = "qwen2.5-coder";
var DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
async function postJson(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return err({ message: `${url} returned ${response.status}: ${text.slice(0, 200)}` });
    }
    return ok(await response.json());
  } catch (error) {
    const reason = error.name === "AbortError" ? `timed out after ${timeoutMs}ms` : error.message;
    return err({ message: `request to ${url} failed: ${reason}` });
  } finally {
    clearTimeout(timer);
  }
}
function createOllamaProvider(options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions = options.retryOptions ?? DEFAULT_RETRY;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/chat`;
  return {
    complete(prompt) {
      return retry(async () => {
        const response = await postJson(
          url,
          { model: options.model, stream: false, messages: [{ role: "user", content: prompt }] },
          {},
          timeoutMs
        );
        if (!isOk(response)) return response;
        const content = response.value.message?.content;
        if (typeof content !== "string") {
          return err({ message: "Ollama response had no message.content" });
        }
        return ok(content);
      }, retryOptions);
    }
  };
}
function createOpenAiCompatibleProvider(options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOptions = options.retryOptions ?? DEFAULT_RETRY;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    complete(prompt) {
      return retry(async () => {
        const response = await postJson(
          url,
          { model: options.model, messages: [{ role: "user", content: prompt }] },
          { Authorization: `Bearer ${options.apiKey}` },
          timeoutMs
        );
        if (!isOk(response)) return response;
        const content = response.value.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          return err({ message: "OpenAI-compatible response had no choices[0].message.content" });
        }
        return ok(content);
      }, retryOptions);
    }
  };
}
function selectProvider(env) {
  const provider = (env.PRMAP_LLM_PROVIDER ?? "ollama").toLowerCase();
  const parsedTimeout = env.PRMAP_LLM_TIMEOUT_MS ? Number.parseInt(env.PRMAP_LLM_TIMEOUT_MS, 10) : void 0;
  const timeoutMs = parsedTimeout !== void 0 && Number.isFinite(parsedTimeout) ? parsedTimeout : void 0;
  if (provider === "ollama") {
    return ok(
      createOllamaProvider({
        model: env.PRMAP_LLM_MODEL ?? DEFAULT_OLLAMA_MODEL,
        baseUrl: env.PRMAP_LLM_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
        timeoutMs
      })
    );
  }
  if (provider === "openai-compatible") {
    if (!env.PRMAP_LLM_BASE_URL) {
      return err({
        message: "PRMAP_LLM_BASE_URL is required for the openai-compatible provider (e.g. https://api.openai.com/v1)."
      });
    }
    if (!env.PRMAP_LLM_API_KEY) {
      return err({ message: "PRMAP_LLM_API_KEY is required for the openai-compatible provider." });
    }
    if (!env.PRMAP_LLM_MODEL) {
      return err({
        message: "PRMAP_LLM_MODEL is required for the openai-compatible provider (e.g. gpt-4o-mini)."
      });
    }
    return ok(
      createOpenAiCompatibleProvider({
        baseUrl: env.PRMAP_LLM_BASE_URL,
        apiKey: env.PRMAP_LLM_API_KEY,
        model: env.PRMAP_LLM_MODEL,
        timeoutMs
      })
    );
  }
  return err({
    message: `Unknown PRMAP_LLM_PROVIDER "${provider}". Use "ollama" or "openai-compatible".`
  });
}

// src/enrich.ts
var ENRICHMENT_CONTRACT = `Return ONLY a JSON object (no prose, no markdown fences) of the form:
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
function edgesTouching(graph, nodeId) {
  return graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}
function buildPrompt(nodes, graph) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sections = nodes.map((node) => {
    const edgeLines = edgesTouching(graph, node.id).map((edge) => {
      const otherId = edge.source === node.id ? edge.target : edge.source;
      const direction = edge.source === node.id ? "imports" : "imported by";
      const neighborSummary = nodesById.get(otherId)?.summary;
      const note = neighborSummary ? ` \u2014 ${neighborSummary}` : "";
      return `  - edgeId "${edge.id}": ${direction} ${otherId} (${edge.kind}, ${edge.origin})${note}`;
    });
    return [
      `### File: ${node.path} (${node.language})`,
      node.patch ? `Diff:
${node.patch}` : "(no diff available)",
      edgeLines.length > 0 ? `Edges touching this file:
${edgeLines.join("\n")}` : "No edges touch this file."
    ].join("\n");
  });
  return [
    `You are reviewing files changed in GitHub pull request #${graph.meta.number}: "${graph.meta.title}".`,
    graph.meta.description ? `PR description:
${graph.meta.description}` : "",
    "Analyze each file below and produce review enrichment for it.",
    sections.join("\n\n"),
    ENRICHMENT_CONTRACT
  ].filter((part) => part.length > 0).join("\n\n");
}
function stripCodeFences(text) {
  return text.replace(/```(?:json)?/gi, "");
}
function extractJson(text) {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  let start = -1;
  if (firstObject === -1) start = firstArray;
  else if (firstArray === -1) start = firstObject;
  else start = Math.min(firstObject, firstArray);
  if (start === -1) return null;
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
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
function parseEnrichmentResponse(text) {
  const jsonText = extractJson(stripCodeFences(text).trim());
  if (jsonText === null) return err({ message: "no JSON found in model response" });
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return err({ message: `invalid JSON in model response: ${error.message}` });
  }
  return ok(flattenResults(parsed));
}
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
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
function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
async function enrichGraph(graph, deps) {
  const changedNodes = graph.nodes.filter((node) => node.inPr);
  if (changedNodes.length === 0) return [];
  const batchSize = changedNodes.length <= 10 ? 1 : 5;
  const batches = chunk(changedNodes, batchSize);
  let completed = 0;
  const perBatch = await mapWithConcurrency(batches, deps.concurrency ?? 4, async (batch) => {
    const label = batch.map((node) => node.path).join(", ");
    let results = [];
    const completion = await deps.provider.complete(buildPrompt(batch, graph));
    if (!isOk(completion)) {
      deps.log?.(`enrichment failed for ${label}: ${completion.error.message}`);
    } else {
      const parsed = parseEnrichmentResponse(completion.value);
      if (!isOk(parsed)) {
        deps.log?.(`could not parse enrichment for ${label}: ${parsed.error.message}`);
      } else {
        results = parsed.value;
      }
    }
    completed += 1;
    await deps.onBatch?.(results, { completed, total: batches.length });
    return results;
  });
  return perBatch.flat();
}
async function enrichFromDir(dataDir, env) {
  const graphPath = join(dataDir, "graph.json");
  let graph;
  try {
    graph = JSON.parse(await readFile(graphPath, "utf8"));
  } catch (error) {
    return err({ message: `could not read ${graphPath}: ${error.message}` });
  }
  const providerResult = selectProvider(env);
  if (!isOk(providerResult)) return err({ message: providerResult.error.message });
  const parsedConcurrency = env.PRMAP_ENRICH_CONCURRENCY ? Number.parseInt(env.PRMAP_ENRICH_CONCURRENCY, 10) : NaN;
  const concurrency = Number.isFinite(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 4;
  const enrichmentDir = join(dataDir, "enrichment");
  try {
    await rm(enrichmentDir, { recursive: true, force: true });
    await mkdir(enrichmentDir, { recursive: true });
  } catch (error) {
    return err({ message: `could not prepare ${enrichmentDir}: ${error.message}` });
  }
  const changedCount = graph.nodes.filter((node) => node.inPr).length;
  console.warn(`pr-map: enriching ${changedCount} changed file(s) with concurrency ${concurrency}...`);
  let writeCursor = 0;
  const results = await enrichGraph(graph, {
    provider: providerResult.value,
    concurrency,
    log: (message) => console.warn(`pr-map: ${message}`),
    onBatch: async (batchResults, progress) => {
      const startIndex = writeCursor;
      writeCursor += batchResults.length;
      const filesThroughHere = writeCursor;
      await Promise.all(
        batchResults.map(
          (result, offset) => writeFile(
            join(enrichmentDir, `${startIndex + offset}.json`),
            JSON.stringify(result, null, 2),
            "utf8"
          ).catch((error) => {
            console.warn(
              `pr-map: could not write enrichment for ${result.path}: ${error.message}`
            );
          })
        )
      );
      console.warn(
        `pr-map: enriched ${progress.completed}/${progress.total} batch(es), ${filesThroughHere} file(s) written`
      );
    }
  });
  return ok({ enrichmentDir, written: results.length });
}
async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error("usage: enrich.js <dataDir>");
    process.exit(1);
  }
  const result = await enrichFromDir(resolve(dataDir), process.env);
  if (!isOk(result)) {
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
  buildPrompt,
  enrichFromDir,
  enrichGraph,
  parseEnrichmentResponse
};
