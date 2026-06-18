import { describe, expect, it } from 'vitest';
import { extractChangedSymbols } from './changed-symbols.js';

describe('extractChangedSymbols', () => {
  it('pulls the enclosing exported function from a hunk header', () => {
    const patch = [
      '@@ -767,7 +771,7 @@ export async function createDebt(input: NewDebt, db: Db = createDb()) {',
      '-      startedAt: new Date(input.startedAt),',
      '+      startedAt: new Date(input.startedAt ?? new Date().toISOString()),',
    ].join('\n');
    const symbols = extractChangedSymbols({ patch, language: 'typescript', status: 'modified' });
    expect(symbols.has('createDebt')).toBe(true);
  });

  it('pulls an exported const added on a changed line', () => {
    const patch = ['@@ -1,0 +1,1 @@', '+export const featureFlag = true;'].join('\n');
    const symbols = extractChangedSymbols({ patch, language: 'typescript', status: 'modified' });
    expect(symbols.has('featureFlag')).toBe(true);
  });

  it('returns every export of an added file from head content, not internal symbols', () => {
    const headContent = [
      'export function runAction() {}',
      'export type ActionToastOptions = { processing?: string };',
      'const internalHelper = 1;',
    ].join('\n');
    const symbols = extractChangedSymbols({
      patch: '',
      headContent,
      language: 'typescript',
      status: 'added',
    });
    expect(symbols.has('runAction')).toBe(true);
    expect(symbols.has('ActionToastOptions')).toBe(true);
    expect(symbols.has('internalHelper')).toBe(false);
  });

  it('pulls python def and class names from changed lines', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      '-def old_name():',
      '+def generate_recurring():',
      '+class DebtBatch:',
    ].join('\n');
    const symbols = extractChangedSymbols({ patch, language: 'python', status: 'modified' });
    expect(symbols.has('generate_recurring')).toBe(true);
    expect(symbols.has('DebtBatch')).toBe(true);
  });

  it('returns an empty set for an unsupported language', () => {
    const symbols = extractChangedSymbols({
      patch: '@@ -1 +1 @@\n+{ "a": 1 }',
      language: 'json',
      status: 'modified',
    });
    expect(symbols.size).toBe(0);
  });
});
