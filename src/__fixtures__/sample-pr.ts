import type { RawPr } from '../fetch-pr.js';
import type { PrMeta } from '../types.js';

const meta: PrMeta = {
  owner: 'acme',
  repo: 'shop',
  number: 7,
  title: 'Add discounts',
  description: 'Adds a discount calculator and wires it into checkout.',
  author: 'octocat',
  baseRef: 'main',
  headRef: 'feature/discount',
};

// Every file the (imaginary) repo tracks, including unchanged neighbors.
export const sampleRepoFiles = new Set<string>([
  'src/app.ts',
  'lib/db.ts',
  'scripts/run.py',
  'src/util.ts',
  'lib/config.ts',
  'pkg/core.py',
  'src/caller.ts',
]);

export const sampleRawPr: RawPr = {
  meta,
  diff: 'full diff placeholder',
  files: [
    {
      path: 'src/app.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      patch: '@@ app patch @@',
      content:
        "import { helper } from './util';\n" +
        "import { db } from '../lib/db';\n" +
        "import express from 'express';\n",
    },
    {
      path: 'lib/db.ts',
      status: 'modified',
      additions: 2,
      deletions: 0,
      patch: '@@ db patch @@',
      content: "import { config } from './config';\n",
    },
    {
      path: 'scripts/run.py',
      status: 'added',
      additions: 4,
      deletions: 0,
      patch: '@@ run patch @@',
      content: 'from pkg.core import run\nimport os\n',
    },
  ],
};
