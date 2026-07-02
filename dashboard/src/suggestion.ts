export const SUGGESTION_FENCE = '```suggestion';

export function currentLineContents(
  diffLines: string[],
  lineMeta: { newLine: number | null }[],
  startLine: number,
  endLine: number,
): string[] {
  const contents: string[] = [];
  for (let index = 0; index < diffLines.length; index += 1) {
    const newLine = lineMeta[index]?.newLine ?? null;
    if (newLine === null || newLine < startLine || newLine > endLine) continue;
    contents.push(diffLines[index].slice(1));
  }
  return contents;
}

export function buildSuggestionBlock(replacementLines: string[]): string {
  return [SUGGESTION_FENCE, ...replacementLines, '```'].join('\n');
}

export function hasSuggestionBlock(body: string): boolean {
  return /^```suggestion\b/m.test(body);
}
