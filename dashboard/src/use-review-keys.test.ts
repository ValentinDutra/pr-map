import { describe, expect, it } from 'vitest';
import { nextIndex, prevIndex, nextUnviewedIndex } from './use-review-keys';

describe('nextIndex / prevIndex', () => {
  it('wraps forward and backward', () => {
    expect(nextIndex(3, 0)).toBe(1);
    expect(nextIndex(3, 2)).toBe(0);
    expect(prevIndex(3, 0)).toBe(2);
    expect(prevIndex(3, 1)).toBe(0);
  });

  it('starts at the first file when nothing is selected', () => {
    expect(nextIndex(3, -1)).toBe(0);
    expect(prevIndex(3, -1)).toBe(0);
  });

  it('is -1 for an empty list', () => {
    expect(nextIndex(0, -1)).toBe(-1);
    expect(prevIndex(0, -1)).toBe(-1);
  });
});

describe('nextUnviewedIndex', () => {
  const paths = ['a', 'b', 'c'];

  it('finds the next unviewed file forward, wrapping', () => {
    expect(nextUnviewedIndex(paths, 0, new Set(['b']))).toBe(2);
    expect(nextUnviewedIndex(paths, 2, new Set(['a']))).toBe(1);
  });

  it('is -1 when every file is viewed', () => {
    expect(nextUnviewedIndex(paths, 0, new Set(['a', 'b', 'c']))).toBe(-1);
  });

  it('starts from the first file when nothing is selected', () => {
    expect(nextUnviewedIndex(paths, -1, new Set())).toBe(0);
  });
});
