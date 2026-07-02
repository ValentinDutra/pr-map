import { describe, it, expect } from 'vitest';
import {
  addIncomingEdges,
  addOutgoingEdges,
  assembleGraph,
  buildNodes,
  detectLanguage,
} from './build-graph.js';
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
  headSha: 'shadiscount',
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

describe('addIncomingEdges', () => {
  const prNodes = buildNodes(sampleRawPr);
  const prFiles = sampleRawPr.files;

  const candidateContent: Record<string, string> = {
    'src/caller.ts': "import { db } from '../lib/db';\n",
    'src/unrelated.ts': 'const db = 1;\n',
  };
  const gitGrep = (pattern: string): string[] =>
    pattern === 'lib/db' ? ['src/caller.ts', 'src/unrelated.ts'] : [];
  const readContent = (path: string): string | undefined => candidateContent[path];

  it('adds an incoming edge from a confirmed importer of a PR file', () => {
    const { edges } = addIncomingEdges(
      prNodes,
      prFiles,
      sampleRepoFiles,
      gitGrep,
      readContent,
    );

    expect(edges).toEqual([
      expect.objectContaining({
        source: 'src/caller.ts',
        target: 'lib/db.ts',
        direction: 'incoming',
        origin: 'static',
        kind: 'import',
      }),
    ]);
  });

  it('drops grep matches that do not actually import the PR file', () => {
    const { nodes, edges } = addIncomingEdges(
      prNodes,
      prFiles,
      sampleRepoFiles,
      gitGrep,
      readContent,
    );

    expect(edges.some((edge) => edge.source === 'src/unrelated.ts')).toBe(false);
    expect(nodes.some((node) => node.id === 'src/unrelated.ts')).toBe(false);
    expect(nodes.find((node) => node.id === 'src/caller.ts')).toMatchObject({
      inPr: false,
    });
  });

  it('finds importers that still reference a renamed file by its old path', () => {
    const renamedNodes = buildNodes({
      ...sampleRawPr,
      files: [
        { path: 'lib/database.ts', previousPath: 'lib/db.ts', status: 'renamed', additions: 1, deletions: 1 },
      ],
    });
    const repoFiles = new Set(['lib/database.ts', 'src/legacy.ts']);
    const grep = (pattern: string): string[] =>
      pattern === 'lib/db' ? ['src/legacy.ts'] : [];
    const read = (path: string): string | undefined =>
      path === 'src/legacy.ts' ? "import { db } from '../lib/db';\n" : undefined;

    const { edges } = addIncomingEdges(
      renamedNodes,
      [{ path: 'lib/database.ts', previousPath: 'lib/db.ts' }],
      repoFiles,
      grep,
      read,
    );

    expect(edges).toEqual([
      expect.objectContaining({ source: 'src/legacy.ts', target: 'lib/database.ts' }),
    ]);
  });
});

describe('assembleGraph', () => {
  const gitGrep = (pattern: string): string[] =>
    pattern === 'lib/db' ? ['src/caller.ts'] : [];
  const readContent = (path: string): string | undefined =>
    path === 'src/caller.ts' ? "import { db } from '../lib/db';\n" : undefined;

  it('combines nodes and edges from both passes, deduped, with the given metadata', () => {
    const graph = assembleGraph(
      sampleRawPr,
      sampleRepoFiles,
      gitGrep,
      readContent,
      '2026-06-17T00:00:00.000Z',
    );

    expect(graph.meta).toEqual(sampleRawPr.meta);
    expect(graph.generatedAt).toBe('2026-06-17T00:00:00.000Z');

    const nodeIds = graph.nodes.map((node) => node.id).sort();
    expect(nodeIds).toEqual(
      [
        'lib/config.ts',
        'lib/db.ts',
        'pkg/core.py',
        'scripts/run.py',
        'src/app.ts',
        'src/caller.ts',
        'src/util.ts',
      ].sort(),
    );
    expect(graph.edges).toHaveLength(5);
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
  });
});

describe('symbol-level neighbor filtering', () => {
  it('keeps incoming importers that use a changed symbol and drops those that do not', () => {
    const target = 'lib/repo.ts';
    const prNodes = buildNodes(
      makeRawPr([
        { path: target, status: 'modified', additions: 1, deletions: 1, patch: '@@ x @@' },
      ]),
    );
    const repoFiles = new Set([target, 'api/debts.ts', 'api/accounts.ts']);
    const content: Record<string, string> = {
      'api/debts.ts': "import { createDebt } from '../lib/repo';\nawait createDebt(x);\n",
      'api/accounts.ts': "import { listAccounts } from '../lib/repo';\nawait listAccounts();\n",
    };
    const grep = (pattern: string): string[] =>
      pattern === 'lib/repo' ? ['api/debts.ts', 'api/accounts.ts'] : [];
    const read = (path: string): string | undefined => content[path];
    const changedSymbolsByPath = new Map([[target, new Set(['createDebt', 'updateDebt'])]]);

    const { nodes, edges } = addIncomingEdges(
      prNodes,
      [{ path: target }],
      repoFiles,
      grep,
      read,
      changedSymbolsByPath,
    );

    expect(edges.map((edge) => edge.source)).toEqual(['api/debts.ts']);
    expect(edges[0]).toMatchObject({ affectedSymbol: 'createDebt' });
    expect(nodes.some((node) => node.id === 'api/accounts.ts')).toBe(false);
  });

  it('keeps an outgoing dependency referenced on a changed line and drops one that is not', () => {
    const raw = makeRawPr([
      {
        path: 'lib/repo.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch:
          '@@ -1,1 +1,1 @@\n' +
          '-type NewDebt = Omit<Debt, "id">;\n' +
          '+type NewDebt = Omit<Debt, "id" | "startedAt">;\n',
        content: "import { Debt } from './types';\nimport { debts } from './schema';\n",
      },
    ]);
    const repoFiles = new Set(['lib/repo.ts', 'lib/types.ts', 'lib/schema.ts']);

    const { nodes, edges } = addOutgoingEdges(buildNodes(raw), raw, repoFiles);

    const targets = edges.map((edge) => edge.target);
    expect(targets).toContain('lib/types.ts');
    expect(targets).not.toContain('lib/schema.ts');
    expect(edges.find((edge) => edge.target === 'lib/types.ts')).toMatchObject({
      affectedSymbol: 'Debt',
    });
    expect(nodes.some((node) => node.id === 'lib/schema.ts')).toBe(false);
  });
});
