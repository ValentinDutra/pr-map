import { describe, it, expect } from 'vitest';
import { findRule } from './import-rules.js';

describe('javascript/typescript import resolution', () => {
  const repoFiles = new Set(['src/result.ts', 'src/index.js', 'lib/util/index.tsx']);
  const rule = findRule('src/retry.ts');

  it('resolves a NodeNext ".js" specifier to the corresponding ".ts" file', () => {
    expect(rule?.resolve('./result.js', 'src/retry.ts', repoFiles)).toContain('src/result.ts');
  });

  it('resolves a plain ".js" specifier to a real ".js" file', () => {
    expect(rule?.resolve('./index.js', 'src/app.js', repoFiles)).toContain('src/index.js');
  });

  it('resolves a directory import to its index file', () => {
    expect(rule?.resolve('../lib/util', 'src/app.ts', repoFiles)).toContain(
      'lib/util/index.tsx',
    );
  });

  it('ignores bare (external) specifiers', () => {
    expect(rule?.resolve('express', 'src/app.ts', repoFiles)).toEqual([]);
  });

  it('strips a bundler query suffix before resolving', () => {
    expect(rule?.resolve('./result.js?worker', 'src/retry.ts', repoFiles)).toContain(
      'src/result.ts',
    );
  });
});
