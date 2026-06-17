import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 60;

export function layoutGraph<NodeType extends Node>(
  nodes: NodeType[],
  edges: Edge[],
): NodeType[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100 });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      ...node,
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
    };
  });
}
