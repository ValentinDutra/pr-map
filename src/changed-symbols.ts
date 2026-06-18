export interface ChangedSymbolsInput {
  patch: string;
  headContent?: string;
  language: string;
  status?: string;
}

const JS_TS_LANGUAGES = new Set(['typescript', 'javascript']);

type NamesExtractor = (code: string) => string[];

// Exported declaration names visible in a single line of JS/TS source. Only exported
// symbols can be imported elsewhere, so those are the ones that decide affectedness.
function jsTsNamesFrom(code: string): string[] {
  const names: string[] = [];
  const declarationPatterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of declarationPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) names.push(match[1]);
  }
  // Re-export lists: `export { foo, bar as baz }` exports `foo` and `baz`.
  const bracedExports = /\bexport\s*\{([^}]*)\}/g;
  let bracedMatch: RegExpExecArray | null;
  while ((bracedMatch = bracedExports.exec(code)) !== null) {
    for (const part of bracedMatch[1].split(',')) {
      const token = part.trim();
      if (!token) continue;
      const aliasMatch = /\bas\s+([A-Za-z_$][\w$]*)/.exec(token);
      const name = aliasMatch ? aliasMatch[1] : token.split(/\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

// Top-level (module-public) names in a single line of Python source.
function pythonNamesFrom(code: string): string[] {
  const names: string[] = [];
  const declarationPatterns = [
    /(?:^|\s)(?:async\s+)?def\s+([A-Za-z_]\w*)/g,
    /(?:^|\s)class\s+([A-Za-z_]\w*)/g,
  ];
  for (const pattern of declarationPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) names.push(match[1]);
  }
  return names;
}

// The code fragments a diff actually changed: each hunk header's enclosing-declaration
// context (git puts it after the second `@@`) plus every added/removed line's content.
function relevantCodeFragments(patch: string): string[] {
  const fragments: string[] = [];
  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const context = /^@@.*?@@ ?(.*)$/.exec(rawLine);
      if (context && context[1]) fragments.push(context[1]);
      continue;
    }
    if (rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
    if (rawLine.startsWith('+') || rawLine.startsWith('-')) {
      fragments.push(rawLine.slice(1));
    }
  }
  return fragments;
}

export function extractChangedSymbols(input: ChangedSymbolsInput): Set<string> {
  const namesFrom: NamesExtractor | null = JS_TS_LANGUAGES.has(input.language)
    ? jsTsNamesFrom
    : input.language === 'python'
      ? pythonNamesFrom
      : null;
  if (!namesFrom) return new Set();

  const result = new Set<string>();
  // An added file is entirely new, so every export it declares is "changed".
  if (input.status === 'added' && input.headContent) {
    for (const line of input.headContent.split('\n')) {
      for (const name of namesFrom(line)) result.add(name);
    }
    return result;
  }
  for (const fragment of relevantCodeFragments(input.patch ?? '')) {
    for (const name of namesFrom(fragment)) result.add(name);
  }
  return result;
}
