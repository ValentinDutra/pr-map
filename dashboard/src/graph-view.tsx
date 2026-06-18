import { type CSSProperties, useEffect, useMemo, useState } from 'react';
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

// Grey solid line for a real import, dashed purple for an AI-inferred link.
function edgeBaseStyle(origin: string): CSSProperties {
  return origin === 'llm'
    ? { strokeDasharray: '6 4', stroke: '#a855f7' }
    : { stroke: '#64748b' };
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
    // Only label an edge with the concrete changed symbol that crosses it. The line style
    // (solid grey = real import, dashed purple = AI-inferred) already conveys the type, and
    // the confidence and plain-language rationale live in the detail panel — so we skip the
    // generic "import" / "semantic ~60%" tags that just cluttered the map.
    label: edge.affectedSymbol || undefined,
    labelStyle: { fontFamily: 'ui-monospace, monospace', fontSize: 11, fill: '#475569' },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    data: { origin: edge.origin },
    animated: false,
    style: edgeBaseStyle(edge.origin),
  }));

  return { nodes: layoutGraph(nodes, edges), edges };
}

export function GraphView({ graph }: { graph: PrGraph }) {
  const [query, setQuery] = useState('');
  const select = useSelection((state) => state.select);
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const layout = useMemo(() => buildFlow(graph, query), [graph, query]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FileFlowNode>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // The selected file, the files it links to, and the edges between them — used to animate
  // the flow between the focused file and its neighbours and fade everything else.
  const focus = useMemo(() => {
    if (!selectedNodeId) return null;
    const neighbors = new Set<string>([selectedNodeId]);
    const connectedEdgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        neighbors.add(edge.source);
        neighbors.add(edge.target);
        connectedEdgeIds.add(edge.id);
      }
    }
    return { neighbors, connectedEdgeIds };
  }, [graph.edges, selectedNodeId]);

  // Re-apply the dagre layout whenever the graph or search query changes; between
  // those changes the user can freely drag nodes (onNodesChange keeps them in state).
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  // Emphasise the focused file's flow without disturbing node positions: connected edges
  // animate and brighten, unrelated edges and nodes fade. Each edge's style is recomputed
  // from its origin so deselecting always restores the base look.
  useEffect(() => {
    setEdges((current) =>
      current.map((edge) => {
        const origin = (edge.data as { origin?: string } | undefined)?.origin ?? 'static';
        const base = edgeBaseStyle(origin);
        if (!focus) return { ...edge, animated: false, style: { ...base, opacity: 1, strokeWidth: 1.5 } };
        const connected = focus.connectedEdgeIds.has(edge.id);
        return {
          ...edge,
          animated: connected,
          style: { ...base, opacity: connected ? 1 : 0.3, strokeWidth: connected ? 2.5 : 1 },
        };
      }),
    );
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          focused: focus ? node.id === selectedNodeId : false,
          dimmed: focus ? !focus.neighbors.has(node.id) : false,
        },
      })),
    );
  }, [focus, selectedNodeId, layout, setEdges, setNodes]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-md bg-white/90 p-3 shadow dark:bg-slate-900/90">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          #{graph.meta.number} {graph.meta.title}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files…"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          solid grey = real import · dashed purple = AI-inferred
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          click a file to trace its flow
        </div>
        {graph.hiddenNeighborCount > 0 ? (
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {graph.hiddenNeighborCount} importer{graph.hiddenNeighborCount === 1 ? '' : 's'} with no
            affected symbols, hidden
          </div>
        ) : null}
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
