import { useSelection } from './store';

interface DiffLineMeta {
  newLine: number | null;
}

// Walks the unified-diff hunks to assign each row its new-file line number.
// Added/context rows get a line you can comment on; removed rows and headers do not.
function computeLineMeta(patch: string): DiffLineMeta[] {
  const meta: DiffLineMeta[] = [];
  let newLine = 0;
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      meta.push({ newLine: null });
    } else if (text.startsWith('-') && !text.startsWith('---')) {
      meta.push({ newLine: null });
    } else if (text.startsWith('+') && !text.startsWith('+++')) {
      meta.push({ newLine });
      newLine += 1;
    } else {
      meta.push({ newLine });
      newLine += 1;
    }
  }
  return meta;
}

function lineBackground(text: string): string {
  if (text.startsWith('+') && !text.startsWith('+++')) return 'bg-green-50 dark:bg-green-950/40';
  if (text.startsWith('-') && !text.startsWith('---')) return 'bg-red-50 dark:bg-red-950/40';
  if (text.startsWith('@@')) return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
  return '';
}

export function DiffView({ patch }: { patch: string }) {
  const selectedLine = useSelection((state) => state.selectedLine);
  const setLine = useSelection((state) => state.setLine);
  const lines = patch.split('\n');
  const lineMeta = computeLineMeta(patch);

  return (
    <pre className="overflow-auto rounded border border-slate-200 font-mono text-[11px] leading-4 dark:border-slate-700">
      {lines.map((text, lineIndex) => {
        const newLine = lineMeta[lineIndex]?.newLine ?? null;
        const isSelected = newLine !== null && newLine === selectedLine;
        return (
          <div
            key={lineIndex}
            onClick={() => newLine !== null && setLine(isSelected ? null : newLine)}
            className={`flex ${lineBackground(text)} ${
              newLine !== null ? 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40' : ''
            } ${isSelected ? 'ring-1 ring-inset ring-amber-400' : ''}`}
          >
            <span className="w-8 shrink-0 select-none pr-2 text-right text-slate-400 dark:text-slate-500">
              {newLine ?? ''}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{text || ' '}</span>
          </div>
        );
      })}
    </pre>
  );
}
