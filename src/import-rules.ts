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
    const cleanSpecifier = specifier.replace(/[?#].*$/, '');
    const base = path.normalize(path.join(path.dirname(fromPath), cleanSpecifier));
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/, '');
    const candidates = [
      base,
      ...JS_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...JS_EXTENSIONS.map((extension) => path.join(stem, `index${extension}`)),
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

const goRule: ImportRule = {
  language: 'go',
  extensions: ['go'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const groupPattern = /import\s*\(([\s\S]*?)\)/g;
    let groupMatch: RegExpExecArray | null;
    while ((groupMatch = groupPattern.exec(content)) !== null) {
      const linePattern = /(?:[.\w]+\s+)?"([^"]+)"/g;
      let lineMatch: RegExpExecArray | null;
      while ((lineMatch = linePattern.exec(groupMatch[1])) !== null) {
        specifiers.push(lineMatch[1]);
      }
    }
    const singlePattern = /^\s*import\s+(?:[.\w]+\s+)?"([^"]+)"/gm;
    let singleMatch: RegExpExecArray | null;
    while ((singleMatch = singlePattern.exec(content)) !== null) {
      specifiers.push(singleMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, _fromPath, repoFiles) {
    const importPath = specifier.replace(/\/+$/, '');
    if (!importPath) return [];
    const targets: string[] = [];
    for (const candidate of repoFiles) {
      if (!candidate.endsWith('.go')) continue;
      const directory = path.dirname(candidate);
      if (directory === importPath || directory.endsWith(`/${importPath}`)) {
        targets.push(candidate);
      }
    }
    return targets;
  },
};

const JVM_EXTENSIONS_BY_RULE = ['java', 'kt'];

const javaKotlinRule: ImportRule = {
  language: 'java/kotlin',
  extensions: ['java', 'kt', 'kts'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const pattern = /^\s*import\s+(?!static\s)(\w+(?:\.\w+)*(?:\.\*)?)\s*;?/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
    return specifiers;
  },
  resolve(specifier, _fromPath, repoFiles) {
    if (specifier.endsWith('.*')) {
      const packageDirectory = specifier.slice(0, -2).replace(/\./g, '/');
      if (!packageDirectory) return [];
      const targets: string[] = [];
      for (const candidate of repoFiles) {
        const isJvmSource = JVM_EXTENSIONS_BY_RULE.some((extension) =>
          candidate.endsWith(`.${extension}`),
        );
        if (!isJvmSource) continue;
        const directory = path.dirname(candidate);
        if (directory === packageDirectory || directory.endsWith(`/${packageDirectory}`)) {
          targets.push(candidate);
        }
      }
      return targets;
    }
    const relativePath = specifier.replace(/\./g, '/');
    const targets: string[] = [];
    for (const extension of JVM_EXTENSIONS_BY_RULE) {
      const suffix = `${relativePath}.${extension}`;
      for (const candidate of repoFiles) {
        if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
          targets.push(candidate);
        }
      }
    }
    return targets;
  },
};

const rubyRule: ImportRule = {
  language: 'ruby',
  extensions: ['rb'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const relativePattern = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
    let relativeMatch: RegExpExecArray | null;
    while ((relativeMatch = relativePattern.exec(content)) !== null) {
      specifiers.push(`require_relative:${relativeMatch[1]}`);
    }
    const requirePattern = /^\s*require\s+['"]([^'"]+)['"]/gm;
    let requireMatch: RegExpExecArray | null;
    while ((requireMatch = requirePattern.exec(content)) !== null) {
      specifiers.push(requireMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    if (specifier.startsWith('require_relative:')) {
      const relativeName = specifier.slice('require_relative:'.length);
      const stem = relativeName.replace(/\.rb$/, '');
      const resolved = path.normalize(path.join(path.dirname(fromPath), `${stem}.rb`));
      return repoFiles.has(resolved) ? [resolved] : [];
    }
    const stem = specifier.replace(/\.rb$/, '');
    const suffix = `${stem}.rb`;
    const targets: string[] = [];
    for (const candidate of repoFiles) {
      if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
        targets.push(candidate);
      }
    }
    return targets;
  },
};

const rustRule: ImportRule = {
  language: 'rust',
  extensions: ['rs'],
  extractSpecifiers(content) {
    const specifiers: string[] = [];
    const modPattern = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    let modMatch: RegExpExecArray | null;
    while ((modMatch = modPattern.exec(content)) !== null) {
      specifiers.push(`mod:${modMatch[1]}`);
    }
    const usePattern = /^\s*(?:pub\s+)?use\s+((?:crate|super|self)::[\w:]+)/gm;
    let useMatch: RegExpExecArray | null;
    while ((useMatch = usePattern.exec(content)) !== null) {
      specifiers.push(useMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    const directory = path.dirname(fromPath);
    if (specifier.startsWith('mod:')) {
      const moduleName = specifier.slice('mod:'.length);
      const candidates = [
        path.join(directory, `${moduleName}.rs`),
        path.join(directory, moduleName, 'mod.rs'),
      ];
      return candidates.filter((candidate) => repoFiles.has(candidate));
    }
    const segments = specifier.split('::');
    const withoutRoot = segments.slice(1, -1);
    if (withoutRoot.length === 0) return [];
    const modulePath = withoutRoot.join('/');
    const suffixes = [`${modulePath}.rs`, `${modulePath}/mod.rs`];
    const targets: string[] = [];
    for (const suffix of suffixes) {
      for (const candidate of repoFiles) {
        if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
          targets.push(candidate);
        }
      }
    }
    return targets;
  },
};

export const IMPORT_RULES: ImportRule[] = [
  javascriptRule,
  pythonRule,
  goRule,
  javaKotlinRule,
  rubyRule,
  rustRule,
];

export function findRule(filePath: string): ImportRule | undefined {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  const extension = filePath.slice(lastDot + 1).toLowerCase();
  return IMPORT_RULES.find((rule) => rule.extensions.includes(extension));
}
