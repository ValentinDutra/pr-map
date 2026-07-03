import type { GraphEdge, GraphNode, PrGraph } from './types';

export interface GraphFilterState {
  changedFilesOnly: boolean;
  riskyOnly: boolean;
  folder: string;
}

export const initialGraphFilterState: GraphFilterState = {
  changedFilesOnly: false,
  riskyOnly: false,
  folder: '',
};

export function topLevelDirectory(path: string): string {
  const separatorIndex = path.indexOf('/');
  return separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
}

export function riskCount(node: GraphNode): number {
  return node.insights ? node.insights.risks.length + node.insights.suspectedBugs.length : 0;
}

export function nodeHasRisk(node: GraphNode): boolean {
  return riskCount(node) > 0;
}

export function folderOptions(nodes: GraphNode[]): string[] {
  const folders = new Set<string>();
  for (const node of nodes) {
    folders.add(topLevelDirectory(node.path));
  }
  return Array.from(folders).sort((first, second) => first.localeCompare(second));
}

export function filterGraph(
  graph: PrGraph,
  filters: GraphFilterState,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const passesChangedFilesOnly = (node: GraphNode): boolean =>
    !filters.changedFilesOnly || node.inPr;

  const passesFolder = (node: GraphNode): boolean =>
    filters.folder === '' || topLevelDirectory(node.path) === filters.folder;

  let riskyNeighborhood: Set<string> | null = null;
  if (filters.riskyOnly) {
    const riskyNodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeHasRisk(node)) riskyNodeIds.add(node.id);
    }
    riskyNeighborhood = new Set<string>(riskyNodeIds);
    for (const edge of graph.edges) {
      if (riskyNodeIds.has(edge.source)) riskyNeighborhood.add(edge.target);
      if (riskyNodeIds.has(edge.target)) riskyNeighborhood.add(edge.source);
    }
  }

  const passesRisky = (node: GraphNode): boolean =>
    riskyNeighborhood === null || riskyNeighborhood.has(node.id);

  const visibleNodeIds = new Set<string>();
  const nodes = graph.nodes.filter((node) => {
    const visible =
      passesChangedFilesOnly(node) && passesFolder(node) && passesRisky(node);
    if (visible) visibleNodeIds.add(node.id);
    return visible;
  });

  const edges = graph.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );

  return { nodes, edges };
}
