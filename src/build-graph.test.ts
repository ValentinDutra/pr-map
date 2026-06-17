import { describe, it, expect } from 'vitest';
import { addOutgoingEdges, buildNodes, detectLanguage } from './build-graph.js';
import { sampleRawPr, sampleRepoFiles } from './__fixtures__/sample-pr.js';
import type { RawPr, RawPrFile } from './fetch-pr.js';
import type { PrMeta } from './types.js';

const meta: PrMeta = {
  owner: 'acme',
  repo: 'shop',
  number: 7,
  title: 'Add discounts',
  description: '',
  author: 'octocat',
  baseRef: 'main',
  headRef: 'feature/discount',
};

function makeRawPr(files: RawPrFile[]): RawPr {
  return { meta, files, diff: '' };
}

describe('detectLanguage', () => {
  it('maps known extensions and falls back to unknown for extensionless paths', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript');
    expect(detectLanguage('scripts/run.py')).toBe('python');
    expect(detectLanguage('Dockerfile')).toBe('unknown');
  });
});

describe('buildNodes', () => {
  it('maps changed files to PR nodes with language and change counts', () => {
    const nodes = buildNodes(
      makeRawPr([
        { path: 'src/app.ts', status: 'modified', additions: 4, deletions: 2 },
        { path: 'scripts/run.py', status: 'added', additions: 10, deletions: 0 },
      ]),
    );

    expect(nodes[0]).toMatchObject({
      id: 'src/app.ts',
      path: 'src/app.ts',
      language: 'typescript',
      inPr: true,
      status: 'modified',
      additions: 4,
      deletions: 2,
    });
    expect(nodes[1].language).toBe('python');
  });

  it('uses the new path as the node id for renamed files', () => {
    const nodes = buildNodes(
      makeRawPr([
        {
          path: 'src/new.ts',
          previousPath: 'src/old.ts',
          status: 'renamed',
          additions: 0,
          deletions: 0,
        },
      ]),
    );

    expect(nodes[0].id).toBe('src/new.ts');
  });
});

describe('addOutgoingEdges', () => {
  it('creates static edges for resolved relative imports across JS/TS and Python', () => {
    const nodes = buildNodes(sampleRawPr);
    const { edges } = addOutgoingEdges(nodes, sampleRawPr, sampleRepoFiles);

    const edgeKeys = edges.map((edge) => `${edge.source}->${edge.target}`);
    expect(edgeKeys).toContain('src/app.ts->lib/db.ts');
    expect(edgeKeys).toContain('src/app.ts->src/util.ts');
    expect(edgeKeys).toContain('lib/db.ts->lib/config.ts');
    expect(edgeKeys).toContain('scripts/run.py->pkg/core.py');
    expect(edges).toHaveLength(4);
    for (const edge of edges) {
      expect(edge.origin).toBe('static');
      expect(edge.direction).toBe('outgoing');
      expect(edge.kind).toBe('import');
    }
  });

  it('adds resolved targets that are not in the PR as neighbor nodes', () => {
    const nodes = buildNodes(sampleRawPr);
    const { nodes: withNeighbors } = addOutgoingEdges(nodes, sampleRawPr, sampleRepoFiles);

    const neighbor = withNeighbors.find((node) => node.id === 'src/util.ts');
    expect(neighbor).toMatchObject({ inPr: false, language: 'typescript' });
  });

  it('ignores bare/external specifiers like "express" and "os"', () => {
    const nodes = buildNodes(sampleRawPr);
    const { nodes: withNeighbors } = addOutgoingEdges(nodes, sampleRawPr, sampleRepoFiles);

    const ids = withNeighbors.map((node) => node.id);
    expect(ids).not.toContain('express');
    expect(ids).not.toContain('os');
  });
});
