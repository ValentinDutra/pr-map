import { describe, expect, it } from 'vitest';
import { extensionLanguage, languageForPath } from './syntax';

describe('extensionLanguage', () => {
  it('maps known extensions to Prism language ids', () => {
    expect(extensionLanguage('src/App.tsx')).toBe('tsx');
    expect(extensionLanguage('lib/util.ts')).toBe('typescript');
    expect(extensionLanguage('main.py')).toBe('python');
    expect(extensionLanguage('styles.scss')).toBe('scss');
  });

  it('is null for unmapped extensions and extension-less names', () => {
    expect(extensionLanguage('Makefile')).toBeNull();
    expect(extensionLanguage('notes.unknownext')).toBeNull();
  });
});

describe('languageForPath', () => {
  it('returns the language only when its grammar is loaded', () => {
    expect(languageForPath('theme.css')).toBe('css');
    expect(languageForPath('Makefile')).toBeNull();
  });
});
