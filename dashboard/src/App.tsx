import { useEffect, useState } from 'react';
import { GraphView } from './graph-view';
import { Sidebar } from './sidebar';
import graphFixture from './__fixtures__/graph.json';
import type { PrGraph } from './types';

const fixtureGraph = graphFixture as unknown as PrGraph;

export function App() {
  const [graph, setGraph] = useState<PrGraph | null>(null);

  useEffect(() => {
    // Served by the pr-map server this returns the real PR graph; running the static
    // build alone (no server) falls back to the checked-in fixture.
    fetch('/api/graph')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no graph'))))
      .then((data: PrGraph) => setGraph(data))
      .catch(() => setGraph(fixtureGraph));
  }, []);

  if (!graph) {
    return <div className="p-6 text-sm text-slate-500">Loading PR graph…</div>;
  }

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1">
        <GraphView graph={graph} />
      </div>
      <Sidebar graph={graph} />
    </div>
  );
}
