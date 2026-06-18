import type { GraphEdge, GraphNode, PrGraph } from './types';

// Local-only filter state for the graph view. Kept out of the shared store on purpose so this
// feature stays self-contained: nothing else in the app needs to read or write these flags.
export interface GraphFilterState {
  changedFilesOnly: boolean;
  riskyOnly: boolean;
  // Empty string means "all folders"; otherwise the top-level directory of a file's path.
  folder: string;
}

export const initialGraphFilterState: GraphFilterState = {
  changedFilesOnly: false,
  riskyOnly: false,
  folder: '',
};

// The top-level directory of a path: "src/app.ts" -> "src", "README.md" -> "" (repo root).
export function topLevelDirectory(path: string): string {
  const separatorIndex = path.indexOf('/');
  return separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
}

export function nodeHasRisk(node: GraphNode): boolean {
  return Boolean(
    node.insights &&
      node.insights.risks.length + node.insights.suspectedBugs.length > 0,
  );
}

// Distinct top-level directories present in the graph, sorted for a stable dropdown order.
// Files at the repo root (no "/") surface as the empty string and are offered as "(root)".
export function folderOptions(nodes: GraphNode[]): string[] {
  const folders = new Set<string>();
  for (const node of nodes) {
    folders.add(topLevelDirectory(node.path));
  }
  return Array.from(folders).sort((first, second) => first.localeCompare(second));
}

// Which nodes survive every active filter (AND), plus the edges between surviving nodes.
//
// "risky only" keeps each risky file and the files it directly connects to, so a reviewer
// still sees what a risky file touches. The neighbour-keeping is computed before the other
// filters narrow the set, then intersected with them so all filters still compose as AND.
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
    // Snapshot the risky files first, then expand exactly one hop. Reading from the snapshot
    // (not the growing result set) keeps this a true one-hop reach: a neighbour of a risky
    // file is kept, but a neighbour of that neighbour is not.
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
