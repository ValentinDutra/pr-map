import { describe, it, expect } from 'vitest';
import { buildCodeContext } from './code-context';

const diffLines = [
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  ' const b = 2;',
  '-const c = 3;',
  '+const c = 30;',
  '+const d = 4;',
  ' const e = 5;',
  ' const f = 6;',
];
const lineMeta = [
  { oldLine: null, newLine: null },
  { oldLine: 1, newLine: 1 },
  { oldLine: 2, newLine: 2 },
  { oldLine: 3, newLine: null },
  { oldLine: null, newLine: 3 },
  { oldLine: null, newLine: 4 },
  { oldLine: 4, newLine: 5 },
  { oldLine: 5, newLine: 6 },
];

describe('buildCodeContext', () => {
  it('marks the focus line with > and includes context lines with padding', () => {
    const result = buildCodeContext(diffLines, lineMeta, { line: 3 }, 2);
    expect(result.code).toBe(
      [
        '  const a = 1;',
        '  const b = 2;',
        '> const c = 30;',
        '  const d = 4;',
        '  const e = 5;',
      ].join('\n')
    );
    expect(result.label).toBe('line 3');
  });

  it('returns label as "lines A-B" for a range target and marks all focus lines', () => {
    const result = buildCodeContext(diffLines, lineMeta, { startLine: 3, line: 4 }, 1);
    expect(result.code).toBe(
      [
        '  const b = 2;',
        '> const c = 30;',
        '> const d = 4;',
        '  const e = 5;',
      ].join('\n')
    );
    expect(result.label).toBe('lines 3-4');
  });

  it('handles focus line at start of diff (no context before)', () => {
    const result = buildCodeContext(diffLines, lineMeta, { line: 1 }, 2);
    expect(result.code).toBe(
      [
        '> const a = 1;',
        '  const b = 2;',
        '  const c = 30;',
      ].join('\n')
    );
    expect(result.label).toBe('line 1');
  });

  it('handles focus line at end of diff (no context after)', () => {
    const result = buildCodeContext(diffLines, lineMeta, { line: 6 }, 2);
    expect(result.code).toBe(
      [
        '  const d = 4;',
        '  const e = 5;',
        '> const f = 6;',
      ].join('\n')
    );
    expect(result.label).toBe('line 6');
  });

  it('uses default padding of 3 when not specified', () => {
    const result = buildCodeContext(diffLines, lineMeta, { line: 4 });
    expect(result.code).toBe(
      [
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 30;',
        '> const d = 4;',
        '  const e = 5;',
        '  const f = 6;',
      ].join('\n')
    );
  });
});
