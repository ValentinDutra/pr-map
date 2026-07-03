import { describe, it, expect } from 'vitest';
import {
  buildSuggestionBlock,
  currentLineContents,
  hasSuggestionBlock,
} from './suggestion';

const diffLines = [
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
];
const lineMeta = [
  { newLine: null },
  { newLine: 1 },
  { newLine: null },
  { newLine: 2 },
  { newLine: 3 },
];

describe('currentLineContents', () => {
  it('returns the right-side content of a single new-file line, marker stripped', () => {
    expect(currentLineContents(diffLines, lineMeta, 2, 2)).toEqual(['const b = 3;']);
  });

  it('returns context and added lines across a range, in file order, skipping removed lines', () => {
    expect(currentLineContents(diffLines, lineMeta, 1, 3)).toEqual([
      'const a = 1;',
      'const b = 3;',
      'const c = 4;',
    ]);
  });

  it('strips only the single leading marker, preserving indentation', () => {
    const indented = ['+    deep = true;'];
    expect(currentLineContents(indented, [{ newLine: 5 }], 5, 5)).toEqual(['    deep = true;']);
  });
});

describe('buildSuggestionBlock', () => {
  it('wraps replacement lines in a suggestion fence', () => {
    expect(buildSuggestionBlock(['const b = 3;'])).toBe('```suggestion\nconst b = 3;\n```');
  });

  it('preserves multiple lines', () => {
    expect(buildSuggestionBlock(['a', 'b'])).toBe('```suggestion\na\nb\n```');
  });

  it('emits an empty block (a deletion suggestion) for no lines', () => {
    expect(buildSuggestionBlock([])).toBe('```suggestion\n```');
  });
});

describe('hasSuggestionBlock', () => {
  it('detects a suggestion fence at the start of a line', () => {
    expect(hasSuggestionBlock('```suggestion\nx\n```')).toBe(true);
    expect(hasSuggestionBlock('Please apply:\n```suggestion\nx\n```')).toBe(true);
  });

  it('is false for plain comments and for the word suggestion in prose', () => {
    expect(hasSuggestionBlock('a normal comment')).toBe(false);
    expect(hasSuggestionBlock('here is a suggestion for you')).toBe(false);
  });
});
