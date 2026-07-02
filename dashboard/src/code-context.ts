import type { DiffLineMeta } from './diff-view';
import { currentLineContents } from './suggestion';

export function buildCodeContext(
  lines: string[],
  lineMeta: DiffLineMeta[],
  target: { startLine?: number; line: number },
  padding = 3,
): { code: string; label: string } {
  const focusStart = target.startLine ?? target.line;
  const focusEnd = target.line;

  const contextStart = Math.max(1, focusStart - padding);
  const contextEnd = focusEnd + padding;

  const focusLines = currentLineContents(lines, lineMeta, focusStart, focusEnd);
  const beforeLines = currentLineContents(lines, lineMeta, contextStart, focusStart - 1);
  const afterLines = currentLineContents(lines, lineMeta, focusEnd + 1, contextEnd);

  const markedLines: string[] = [];
  for (const line of beforeLines) {
    markedLines.push(`  ${line}`);
  }
  for (const line of focusLines) {
    markedLines.push(`> ${line}`);
  }
  for (const line of afterLines) {
    markedLines.push(`  ${line}`);
  }

  const label = focusStart === focusEnd ? `line ${focusEnd}` : `lines ${focusStart}-${focusEnd}`;

  return { code: markedLines.join('\n'), label };
}
