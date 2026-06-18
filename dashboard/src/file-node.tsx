import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from './types';

export interface FileNodeData extends Record<string, unknown> {
  label: string;
  language: string;
  inPr: boolean;
  status?: NodeStatus;
  highlighted: boolean;
  hasRisk: boolean;
  // True once the reviewer has checked this changed file off as viewed.
  viewed?: boolean;
  // Set while another file is focused: the focused file itself, vs. an unrelated file to fade.
  focused?: boolean;
  dimmed?: boolean;
}

export type FileFlowNode = Node<FileNodeData, 'file'>;

export function FileNode({ data }: NodeProps<FileFlowNode>) {
  const baseStyle = data.inPr
    ? 'bg-white border-slate-400 text-slate-800 dark:bg-slate-800 dark:border-slate-500 dark:text-slate-100'
    : 'bg-slate-100 border-dashed border-slate-300 text-slate-500 dark:bg-slate-800/50 dark:border-slate-600 dark:text-slate-400';
  const highlight = data.highlighted ? 'ring-2 ring-amber-400' : '';
  const focusRing = data.focused ? 'ring-2 ring-blue-500 dark:ring-blue-400' : '';
  const dim = data.dimmed ? 'opacity-50' : 'opacity-100';
  // A viewed file recedes a little so unreviewed files stand out as the work that remains.
  const viewedStyle = data.viewed ? 'border-green-400 bg-green-50/60 dark:border-green-700 dark:bg-green-950/30' : '';

  return (
    <div
      className={`relative rounded-md border px-3 py-2 shadow-sm transition-opacity ${baseStyle} ${viewedStyle} ${highlight} ${focusRing} ${dim}`}
    >
      {data.hasRisk ? (
        <span
          title="Has review risks or suspected bugs"
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500"
        />
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
