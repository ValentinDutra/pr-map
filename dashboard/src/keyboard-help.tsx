import { useEffect } from 'react';

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous changed file'],
  ['n', 'Next unviewed file'],
  ['v', 'Toggle viewed'],
  ['d / i', 'Diff / Insights tab'],
  ['?', 'Toggle this help'],
];

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/30"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-80 rounded-md border border-slate-200 bg-white p-4 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-100">Keyboard shortcuts</span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map(([keys, description]) => (
              <tr key={keys}>
                <td className="py-0.5 pr-3 align-top font-mono text-xs text-slate-600 dark:text-slate-300">
                  {keys}
                </td>
                <td className="py-0.5 text-slate-700 dark:text-slate-200">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
