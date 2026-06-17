import { describe, it, expect } from 'vitest';
import { mergeEnrichment, type EnrichmentResult } from './merge-enrichment.js';
import type { PrGraph } from './types.js';

const baseGraph: PrGraph = {
  meta: {
    owner: 'acme',
    repo: 'shop',
    number: 7,
    title: 'x',
    description: '',
    author: 'octocat',
    baseRef: 'main',
    headRef: 'feature',
  },
  nodes: [
    { id: 'src/a.ts', path: 'src/a.ts', language: 'typescript', inPr: true },
    { id: 'src/b.ts', path: 'src/b.ts', language: 'typescript', inPr: false },
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
  generatedAt: '2026-06-17T00:00:00.000Z',
  hiddenNeighborCount: 0,
};

const result: EnrichmentResult = {
  path: 'src/a.ts',
  summary: 'Entry module.',
  insights: {
    risks: ['mutates global state'],
    suspectedBugs: [],
    testsToCheck: ['a.test.ts'],
    impact: 'touches checkout',
  },
  edgeWhys: { 'src/a.ts->src/b.ts:import:outgoing': 'a imports b for the query' },
  semanticEdges: [{ target: 'src/c.ts', confidence: 0.5, why: 'likely related' }],
};

describe('mergeEnrichment', () => {
  it('applies summary, insights and edge whys, and adds an llm semantic edge', () => {
    const merged = mergeEnrichment(baseGraph, [result]);

    const node = merged.nodes.find((candidate) => candidate.id === 'src/a.ts');
    expect(node?.summary).toBe('Entry module.');
    expect(node?.insights?.risks).toEqual(['mutates global state']);

    const staticEdge = merged.edges.find(
      (edge) => edge.id === 'src/a.ts->src/b.ts:import:outgoing',
    );
    expect(staticEdge?.why).toBe('a imports b for the query');
    expect(staticEdge?.origin).toBe('static');
    expect(staticEdge?.target).toBe('src/b.ts');

    const semanticEdge = merged.edges.find(
      (edge) => edge.id === 'src/a.ts->src/c.ts:semantic:outgoing',
    );
    expect(semanticEdge).toMatchObject({ origin: 'llm', kind: 'semantic', confidence: 0.5 });
  });

  it('does not mutate the input graph', () => {
    mergeEnrichment(baseGraph, [result]);

    expect(baseGraph.nodes[0].summary).toBeUndefined();
    expect(baseGraph.edges[0].why).toBeUndefined();
    expect(baseGraph.edges).toHaveLength(1);
  });
});
