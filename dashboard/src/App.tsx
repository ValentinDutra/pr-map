import { GraphView } from './graph-view';
import { DetailPanel } from './detail-panel';
import graphFixture from './__fixtures__/graph.json';
import type { PrGraph } from './types';

// Task 9 loads a checked-in fixture. A later task swaps this for GET /api/graph.
const graph = graphFixture as unknown as PrGraph;

export function App() {
  return (
    <div className="relative h-full w-full">
      <GraphView graph={graph} />
      <DetailPanel graph={graph} />
    </div>
  );
}
