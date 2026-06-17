import { describe, it, expect } from 'vitest';
import { buildNodes, detectLanguage } from './build-graph.js';
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
