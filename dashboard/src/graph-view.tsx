import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { GraphEdge, GraphNode, PrGraph } from './types';
import { layoutGraph } from './layout';
import { FileNode, type FileFlowNode } from './file-node';
import { useSelection, usePanelTab } from './store';
import { useViewedState } from './viewed-state';
import { useReviewKeys } from './use-review-keys';
import { KeyboardHelp } from './keyboard-help';
import {
  filterGraph,
  folderOptions,
  initialGraphFilterState,
  nodeHasRisk,
  riskCount,
  type GraphFilterState,
} from './graph-filters';

const nodeTypes: NodeTypes = { file: FileNode };

const edgeRestStyle: CSSProperties = { opacity: 0.85, strokeWidth: 1.5 };
const edgeConnectedStyle: CSSProperties = { opacity: 1, strokeWidth: 2.5 };
const edgeDimmedStyle: CSSProperties = { opacity: 0.18, strokeWidth: 1 };

function edgeClassName(origin: string): string {
  return origin === 'llm' ? 'pr-edge pr-edge-ai' : 'pr-edge pr-edge-static';
}

function buildFlow(
  nodes: GraphNode[],
  edges: GraphEdge[],
  query: string,
): { nodes: FileFlowNode[]; edges: Edge[] } {
  const normalizedQuery = query.trim().toLowerCase();

  const flowNodes: FileFlowNode[] = nodes.map((node) => ({
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
      riskCount: riskCount(node),
    },
  }));

  const flowEdges: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.affectedSymbol || undefined,
    labelStyle: { fontFamily: 'ui-monospace, monospace', fontSize: 11 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    data: { origin: edge.origin },
    className: edgeClassName(edge.origin),
    animated: false,
    style: edgeRestStyle,
  }));

  return { nodes: layoutGraph(flowNodes, flowEdges), edges: flowEdges };
}

export function GraphView({ graph }: { graph: PrGraph }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<GraphFilterState>(initialGraphFilterState);
  const select = useSelection((state) => state.select);
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const viewedPaths = useViewedState((state) => state.viewedPaths);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<FileFlowNode, Edge> | null>(null);
  const [riskIndex, setRiskIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleViewed = useViewedState((state) => state.toggle);
  const setTab = usePanelTab((state) => state.setTab);
  const toggleHelp = useCallback(() => setHelpOpen((open) => !open), []);

  const changedFilePaths = useMemo(
    () => graph.nodes.filter((node) => node.inPr).map((node) => node.path),
    [graph.nodes],
  );
  const viewedChangedCount = changedFilePaths.filter((path) => viewedPaths.has(path)).length;
  const changedNodes = useMemo(
    () => graph.nodes.filter((node) => node.inPr).map((node) => ({ id: node.id, path: node.path })),
    [graph.nodes],
  );

  const folders = useMemo(() => folderOptions(graph.nodes), [graph.nodes]);
  const filtered = useMemo(() => filterGraph(graph, filters), [graph, filters]);
  const riskyNodes = useMemo(() => filtered.nodes.filter(nodeHasRisk), [filtered.nodes]);

  const selectAndPan = useCallback(
    (nodeId: string) => {
      select(nodeId);
      rfInstance?.fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.3 });
    },
    [select, rfInstance],
  );

  const jumpToNextRisk = () => {
    if (riskyNodes.length === 0) return;
    const index = riskIndex % riskyNodes.length;
    setRiskIndex(index + 1);
    selectAndPan(riskyNodes[index].id);
  };

  useReviewKeys({
    nodes: changedNodes,
    selectedNodeId,
    viewedPaths,
    onSelect: selectAndPan,
    onToggleViewed: toggleViewed,
    onSetTab: setTab,
    onToggleHelp: toggleHelp,
  });
  const layout = useMemo(
    () => buildFlow(filtered.nodes, filtered.edges, query),
    [filtered, query],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<FileFlowNode>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  const focus = useMemo(() => {
    if (!selectedNodeId) return null;
    const neighbors = new Set<string>([selectedNodeId]);
    const connectedEdgeIds = new Set<string>();
    for (const edge of filtered.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        neighbors.add(edge.source);
        neighbors.add(edge.target);
        connectedEdgeIds.add(edge.id);
      }
    }
    return { neighbors, connectedEdgeIds };
  }, [filtered.edges, selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId && !filtered.nodes.some((node) => node.id === selectedNodeId)) {
      select(null);
    }
  }, [filtered, selectedNodeId, select]);

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  useEffect(() => {
    setEdges((current) =>
      current.map((edge) => {
        if (!focus) return { ...edge, animated: false, style: edgeRestStyle };
        const connected = focus.connectedEdgeIds.has(edge.id);
        return {
          ...edge,
          animated: connected,
          style: connected ? edgeConnectedStyle : edgeDimmedStyle,
        };
      }),
    );
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          viewed: node.data.inPr && viewedPaths.has(node.data.label),
          focused: focus ? node.id === selectedNodeId : false,
          dimmed: focus ? !focus.neighbors.has(node.id) : false,
        },
      })),
    );
  }, [focus, selectedNodeId, layout, viewedPaths, setEdges, setNodes]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-md bg-white/90 p-3 shadow dark:bg-slate-900/90">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files…"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={filters.changedFilesOnly}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                changedFilesOnly: event.target.checked,
              }))
            }
            className="h-3 w-3"
          />
          Changed files only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={filters.riskyOnly}
            onChange={(event) =>
              setFilters((current) => ({ ...current, riskyOnly: event.target.checked }))
            }
            className="h-3 w-3"
          />
          Risky only
        </label>
        <select
          value={filters.folder}
          onChange={(event) =>
            setFilters((current) => ({ ...current, folder: event.target.value }))
          }
          className="w-64 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">All folders</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder === '' ? '(root)' : folder}
            </option>
          ))}
        </select>
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          showing {filtered.nodes.length} of {graph.nodes.length} files
        </div>
        {changedFilePaths.length > 0 ? (
          <div className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
            viewed {viewedChangedCount} of {changedFilePaths.length}
          </div>
        ) : null}
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          solid blue = real import · dashed purple = AI-inferred
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          click a file to trace its flow
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          press <span className="font-mono">?</span> for keyboard shortcuts
        </div>
        {graph.hiddenNeighborCount > 0 ? (
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {graph.hiddenNeighborCount} importer{graph.hiddenNeighborCount === 1 ? '' : 's'} with no
            affected symbols, hidden
          </div>
        ) : null}
        {riskyNodes.length > 0 ? (
          <button
            type="button"
            onClick={jumpToNextRisk}
            title="Jump to the next file with AI-flagged risks or suspected bugs"
            className="mt-1 self-start rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
          >
            ⚠ {riskyNodes.length} risky · Next →
          </button>
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
        onInit={setRfInstance}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
