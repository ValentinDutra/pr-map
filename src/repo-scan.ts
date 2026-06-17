import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitGrep, ReadContent } from './build-graph.js';

// Real providers for the static graph builder. Thin glue over git/fs; the core
// builder takes these as injected dependencies so it stays pure and testable.

export function createGitGrep(repoRoot: string): GitGrep {
  return (pattern) => {
    try {
      const output = execFileSync('git', ['grep', '-l', '-F', pattern], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      return output.split('\n').filter((line) => line.length > 0);
    } catch {
      // git grep exits non-zero when there are no matches.
      return [];
    }
  };
}

export function createReadContent(repoRoot: string): ReadContent {
  return (path) => {
    try {
      return readFileSync(join(repoRoot, path), 'utf8');
    } catch {
      return undefined;
    }
  };
}

export function listRepoFiles(repoRoot: string): Set<string> {
  try {
    const output = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return new Set(output.split('\n').filter((line) => line.length > 0));
  } catch {
    return new Set();
  }
}
