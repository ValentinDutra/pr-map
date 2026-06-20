import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from './types';

export interface FileNodeData extends Record<string, unknown> {
  label: string;
  language: string;
  inPr: boolean;
  status?: NodeStatus;
  highlighted: boolean;
  // Number of AI-flagged risks + suspected bugs on this file (0 = none / not enriched).
  riskCount: number;
  // True once the reviewer has checked this changed file off as viewed.
  viewed?: boolean;
  // Set while another file is focused: the focused file itself, vs. an unrelated file to fade.
  focused?: boolean;
  dimmed?: boolean;
}

export type FileFlowNode = Node<FileNodeData, 'file'>;

export function FileNode({ data }: NodeProps<FileFlowNode>) {
  const riskCount = data.riskCount ?? 0;
  const isRisky = riskCount > 0;

  const tone = data.inPr
    ? 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
    : 'bg-slate-100 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400';
  const viewedBg = data.viewed ? 'bg-green-50/60 dark:bg-green-950/30' : '';
  // One explicit border color so precedence reads top-down: risk > viewed > changed > neighbor.
  const border = isRisky
    ? 'border-red-400 dark:border-red-600'
    : data.viewed
      ? 'border-green-400 dark:border-green-700'
      : data.inPr
        ? 'border-slate-400 dark:border-slate-500'
        : 'border-dashed border-slate-300 dark:border-slate-600';
  const highlight = data.highlighted ? 'ring-2 ring-amber-400' : '';
  const focusRing = data.focused ? 'ring-2 ring-blue-500 dark:ring-blue-400' : '';
  const dim = data.dimmed ? 'opacity-50' : 'opacity-100';

  return (
    <div
      className={`relative rounded-md border px-3 py-2 shadow-sm transition-opacity ${tone} ${viewedBg} ${border} ${highlight} ${focusRing} ${dim}`}
    >
      {isRisky ? (
        <span
          title={`${riskCount} review risk${riskCount === 1 ? '' : 's'} or suspected bug${riskCount === 1 ? '' : 's'}`}
          className="absolute -right-1.5 -top-1.5 flex h-4 items-center justify-center gap-0.5 rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white"
        >
          ⚠ {riskCount}
        </span>
      ) : null}
      {data.viewed ? (
        <span
          title="Marked as viewed"
          className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold leading-none text-white"
        >
          ✓
        </span>
      ) : null}
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[180px] truncate text-xs font-medium">{data.label}</div>
      <div className="text-[10px] opacity-70">
        {data.language}
        {data.status ? ` · ${data.status}` : ''}
        {data.inPr ? '' : ' · neighbor'}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
