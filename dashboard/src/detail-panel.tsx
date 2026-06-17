import type { GraphEdge, PrGraph } from './types';
import { useSelection } from './store';
import { DiffView } from './diff-view';

function originBadge(edge: GraphEdge): string {
  return edge.origin === 'llm'
    ? 'border-purple-300 bg-purple-50 text-purple-700'
    : 'border-slate-300 bg-slate-50 text-slate-600';
}

export function DetailPanel({ graph }: { graph: PrGraph }) {
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const select = useSelection((state) => state.select);

  if (!selectedNodeId) return null;

  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) return null;

  const connectedEdges = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-96 flex-col gap-3 overflow-auto border-l border-slate-200 bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold text-slate-800">{node.path}</div>
          <div className="text-[11px] text-slate-500">
            {node.language}
            {node.inPr ? ` · ${node.status ?? 'changed'}` : ' · neighbor (not in this PR)'}
            {node.inPr && node.additions !== undefined
              ? ` · +${node.additions} / -${node.deletions ?? 0}`
              : ''}
          </div>
        </div>
        <button
          onClick={() => select(null)}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          Close
        </button>
      </div>

      {node.summary ? (
        <p className="text-xs text-slate-700">{node.summary}</p>
      ) : null}

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Connections ({connectedEdges.length})
        </div>
        <ul className="flex flex-col gap-2">
          {connectedEdges.map((edge) => {
            const isSource = edge.source === node.id;
            const other = isSource ? edge.target : edge.source;
            const arrow = isSource ? '→' : '←';
            return (
              <li key={edge.id} className="rounded border border-slate-200 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-700">
                    {arrow} {other}
                  </span>
                  <span
                    className={`rounded border px-1 text-[10px] ${originBadge(edge)}`}
                  >
                    {edge.origin} · {edge.confidence}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {edge.kind} · {edge.direction}
                </div>
                {edge.why ? (
                  <div className="mt-1 text-[11px] text-slate-600">{edge.why}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {node.inPr && node.patch ? (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Diff
          </div>
          <DiffView patch={node.patch} />
        </div>
      ) : null}
    </aside>
  );
}
