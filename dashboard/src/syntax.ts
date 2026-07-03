import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';

export type SyntaxToken = string | Prism.Token;

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
};

export function extensionLanguage(path: string): string | null {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[extension] ?? null;
}

export function languageForPath(path: string): string | null {
  const language = extensionLanguage(path);
  if (!language) return null;
  return Prism.languages[language] ? language : null;
}

export function tokenizeCode(code: string, language: string): SyntaxToken[] {
  const grammar = Prism.languages[language];
  if (!grammar) return [code];
  return Prism.tokenize(code, grammar);
}
