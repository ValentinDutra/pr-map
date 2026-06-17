import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import type { PrGraph } from './types';
import { layoutGraph } from './layout';
import { FileNode, type FileFlowNode } from './file-node';
import { useSelection } from './store';

const nodeTypes: NodeTypes = { file: FileNode };

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function buildFlow(
  graph: PrGraph,
  query: string,
): { nodes: FileFlowNode[]; edges: Edge[] } {
  const normalizedQuery = query.trim().toLowerCase();

  const nodes: FileFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'file',
    position: { x: 0, y: 0 },
    data: {
      label: node.path,
      language: node.language,
      inPr: node.inPr,
      status: node.status,
      highlighted:
        normalizedQuery.length > 0 &&
        node.path.toLowerCase().includes(normalizedQuery),
      hasRisk: Boolean(
        node.insights &&
          node.insights.risks.length + node.insights.suspectedBugs.length > 0,
      ),
    },
  }));

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label:
      edge.origin === 'llm'
        ? `${edge.kind} ~${formatConfidence(edge.confidence)}`
        : edge.kind,
    animated: edge.direction === 'incoming',
    style:
      edge.origin === 'llm'
        ? { strokeDasharray: '6 4', stroke: '#a855f7' }
        : { stroke: '#64748b' },
  }));

  return { nodes: layoutGraph(nodes, edges), edges };
}

export function GraphView({ graph }: { graph: PrGraph }) {
  const [query, setQuery] = useState('');
  const select = useSelection((state) => state.select);
  const layout = useMemo(() => buildFlow(graph, query), [graph, query]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FileFlowNode>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // Re-apply the dagre layout whenever the graph or search query changes; between
  // those changes the user can freely drag nodes (onNodesChange keeps them in state).
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-md bg-white/90 p-3 shadow">
        <div className="text-sm font-semibold text-slate-800">
          #{graph.meta.number} {graph.meta.title}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files…"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <div className="text-[10px] text-slate-500">
          solid = static import · dashed purple = LLM-inferred
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
