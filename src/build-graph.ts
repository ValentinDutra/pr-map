import type { RawPr } from './fetch-pr.js';
import type { GraphNode } from './types.js';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'css',
  html: 'html',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  sql: 'sql',
};

export function detectLanguage(path: string): string {
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  if (lastDot < 0 || lastDot < lastSlash) return 'unknown';
  const extension = path.slice(lastDot + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? extension;
}

export function buildNodes(rawPr: RawPr): GraphNode[] {
  return rawPr.files.map((file) => ({
    id: file.path,
    path: file.path,
    language: detectLanguage(file.path),
    inPr: true,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    summary: '',
  }));
}
