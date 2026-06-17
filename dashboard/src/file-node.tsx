import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from './types';

export interface FileNodeData extends Record<string, unknown> {
  label: string;
  language: string;
  inPr: boolean;
  status?: NodeStatus;
  highlighted: boolean;
}

export type FileFlowNode = Node<FileNodeData, 'file'>;

export function FileNode({ data }: NodeProps<FileFlowNode>) {
  const baseStyle = data.inPr
    ? 'bg-white border-slate-400 text-slate-800'
    : 'bg-slate-100 border-dashed border-slate-300 text-slate-500';
  const highlight = data.highlighted ? 'ring-2 ring-amber-400' : '';

  return (
    <div
      className={`rounded-md border px-3 py-2 shadow-sm ${baseStyle} ${highlight}`}
    >
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
