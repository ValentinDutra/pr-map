import { posix as path } from 'node:path';

export interface ImportRule {
  language: string;
  extensions: string[];
  extractSpecifiers(content: string): string[];
  resolve(specifier: string, fromPath: string, repoFiles: Set<string>): string[];
}

const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const javascriptRule: ImportRule = {
  language: 'javascript/typescript',
  extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const patterns = [
      /import\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /export\s+[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        specifiers.push(match[1]);
      }
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    if (!specifier.startsWith('.')) return [];
    const base = path.normalize(path.join(path.dirname(fromPath), specifier));
    const candidates = [
      base,
      ...JS_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...JS_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
    ];
    return candidates.filter((candidate) => repoFiles.has(candidate));
  },
};

const pythonRule: ImportRule = {
  language: 'python',
  extensions: ['py'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const patterns = [/^\s*from\s+([.\w]+)\s+import\s+/gm, /^\s*import\s+([.\w]+)/gm];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        specifiers.push(match[1]);
      }
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    let modulePath: string;
    if (specifier.startsWith('.')) {
      const leadingDots = (/^\.+/.exec(specifier) ?? [''])[0].length;
      const rest = specifier.slice(leadingDots).replace(/\./g, '/');
      let baseDirectory = path.dirname(fromPath);
      for (let level = 1; level < leadingDots; level += 1) {
        baseDirectory = path.dirname(baseDirectory);
      }
      modulePath = rest ? path.join(baseDirectory, rest) : baseDirectory;
    } else {
      modulePath = specifier.replace(/\./g, '/');
    }
    const candidates = [`${modulePath}.py`, path.join(modulePath, '__init__.py')];
    return candidates.filter((candidate) => repoFiles.has(candidate));
  },
};

export const IMPORT_RULES: ImportRule[] = [javascriptRule, pythonRule];

export function findRule(filePath: string): ImportRule | undefined {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  const extension = filePath.slice(lastDot + 1).toLowerCase();
  return IMPORT_RULES.find((rule) => rule.extensions.includes(extension));
}
