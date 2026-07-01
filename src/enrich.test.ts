import { describe, it, expect } from 'vitest';
import { buildPrompt, parseEnrichmentResponse, enrichGraph } from './enrich.js';
import { ok, err, isOk, type Result } from './result.js';
import type { LlmError, LlmProvider } from './llm-provider.js';
import type { PrGraph } from './types.js';

const graph: PrGraph = {
  meta: {
    owner: 'acme',
    repo: 'shop',
    number: 7,
    title: 'Add discounts',
    description: '',
    author: 'octocat',
    baseRef: 'main',
    headRef: 'feature',
    headSha: 'sha',
  },
  nodes: [
    {
      id: 'src/a.ts',
      path: 'src/a.ts',
      language: 'typescript',
      inPr: true,
      patch: '@@ -1 +1 @@\n+import { b } from "./b"',
    },
    { id: 'src/b.ts', path: 'src/b.ts', language: 'typescript', inPr: false, summary: 'helper b' },
  ],
  edges: [
    {
      id: 'src/a.ts->src/b.ts:import:outgoing',
      source: 'src/a.ts',
      target: 'src/b.ts',
      kind: 'import',
      direction: 'outgoing',
      origin: 'static',
      confidence: 1,
    },
  ],
  generatedAt: '2026-06-18T00:00:00Z',
  hiddenNeighborCount: 0,
};

function fixedProvider(response: Result<string, LlmError>): LlmProvider {
  return {
    chat: () => Promise.resolve(response),
    complete: () => Promise.resolve(response),
  };
}

describe('buildPrompt', () => {
  it('includes the file path, its diff, and the touching edge id', () => {
    const prompt = buildPrompt([graph.nodes[0]], graph);
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('import { b }');
    expect(prompt).toContain('src/a.ts->src/b.ts:import:outgoing');
  });
});

describe('parseEnrichmentResponse', () => {
  it('parses JSON wrapped in code fences and prose', () => {
    const text =
      'Sure!\n```json\n{ "files": [ { "path": "src/a.ts", "summary": "does a" } ] }\n```\nDone.';
    const result = parseEnrichmentResponse(text);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].path).toBe('src/a.ts');
    }
  });

  it('accepts a bare single object', () => {
    const result = parseEnrichmentResponse('{ "path": "src/a.ts", "summary": "x" }');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value[0].path).toBe('src/a.ts');
  });

  it('returns an error when there is no JSON in the response', () => {
    expect(isOk(parseEnrichmentResponse('no json here'))).toBe(false);
  });
});

describe('enrichGraph', () => {
  it('returns parsed enrichment for the changed files', async () => {
    const provider = fixedProvider(ok('{ "files": [ { "path": "src/a.ts", "summary": "does a" } ] }'));
    const results = await enrichGraph(graph, { provider });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('src/a.ts');
  });

  it('fails open: a provider error yields no enrichment rather than throwing', async () => {
    const messages: string[] = [];
    const results = await enrichGraph(graph, {
      provider: fixedProvider(err({ code: 'request_failed', message: 'model down' })),
      log: (message) => messages.push(message),
    });
    expect(results).toEqual([]);
    expect(messages.join()).toContain('model down');
  });

  it('only enriches changed (inPr) files', async () => {
    let calls = 0;
    const provider: LlmProvider = {
      chat: () => {
        calls += 1;
        return Promise.resolve(ok('{ "files": [] }'));
      },
      complete() {
        return this.chat([]);
      },
    };
    await enrichGraph(graph, { provider });
    // One changed file -> one batch -> one provider call; the neighbor src/b.ts is not enriched.
    expect(calls).toBe(1);
  });

  it('reports progress through onBatch with a cumulative completed count', async () => {
    const many: PrGraph = {
      ...graph,
      nodes: Array.from({ length: 12 }, (_unused, index) => ({
        id: `src/f${index}.ts`,
        path: `src/f${index}.ts`,
        language: 'typescript',
        inPr: true,
        patch: '@@ -1 +1 @@\n+x',
      })),
      edges: [],
    };
    const progress: { completed: number; total: number }[] = [];
    await enrichGraph(many, {
      provider: fixedProvider(ok('{ "files": [] }')),
      onBatch: (_results, current) => {
        progress.push(current);
      },
    });
    // 12 changed files batch into 5 + 5 + 2 = 3 batches; each reports the same total once.
    expect(progress.map((entry) => entry.total)).toEqual([3, 3, 3]);
    expect(progress.map((entry) => entry.completed).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('still fires onBatch for a failed batch, with no results (partial-results path)', async () => {
    const reported: number[] = [];
    await enrichGraph(graph, {
      provider: fixedProvider(err({ code: 'request_failed', message: 'down' })),
      onBatch: (results) => {
        reported.push(results.length);
      },
    });
    expect(reported).toEqual([0]);
  });
});
