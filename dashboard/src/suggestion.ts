// GitHub "suggested changes": a reviewer proposes the exact replacement text for the line(s) a
// comment is anchored to by wrapping it in a ```suggestion fenced block inside the comment body.
// GitHub renders that block as an applyable suggestion. Everything here is pure string work so it
// can be unit-tested without a DOM; the diff view supplies the parsed diff lines and their
// new-file line numbers, and the existing comment-submission path carries the body verbatim.

export const SUGGESTION_FENCE = '```suggestion';

// The current right-side content of the new-file lines covered by [startLine, endLine]. A unified
// diff row for a right-side line is either an added line ("+…") or a context line (" …"); both
// carry a single leading marker character that is not part of the file content, so it is stripped.
// Removed lines ("-…") never have a new-file number and are skipped. The lines come back in file
// order — exactly the text a suggestion should default to replacing.
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
    // Strip the single leading diff marker ("+" or " "); the rest is the verbatim file content.
    contents.push(diffLines[index].slice(1));
  }
  return contents;
}

// Wrap replacement lines in a ```suggestion block. An empty list yields a block with no body,
// which GitHub interprets as "delete the commented line(s)". The closing fence is on its own line.
export function buildSuggestionBlock(replacementLines: string[]): string {
  return [SUGGESTION_FENCE, ...replacementLines, '```'].join('\n');
}

// Whether a comment body already carries a suggestion block, so the editor can avoid stacking a
// second one and can hint that the comment is a suggestion. The fence must start a line (GitHub's
// own rule) — matched with a multiline anchor so leading prose above it still counts.
export function hasSuggestionBlock(body: string): boolean {
  return /^```suggestion\b/m.test(body);
}
