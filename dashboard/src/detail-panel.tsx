import { useState } from 'react';
import type { GraphEdge, PrGraph } from './types';
import { useSelection } from './store';
import { DiffView } from './diff-view';
import { reviewApi } from './review-api';

function originBadge(edge: GraphEdge): string {
  return edge.origin === 'llm'
    ? 'border-purple-300 bg-purple-50 text-purple-700'
    : 'border-slate-300 bg-slate-50 text-slate-600';
}

interface DetailPanelProps {
  graph: PrGraph;
  onChange: () => void;
  setStatus: (status: string | null) => void;
}

export function DetailPanel({ graph, onChange, setStatus }: DetailPanelProps) {
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const selectedLine = useSelection((state) => state.selectedLine);
  const [body, setBody] = useState('');

  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) {
    return (
      <p className="text-xs text-slate-400">
        Select a file node to see its connections, diff, and to comment.
      </p>
    );
  }

  const connectedEdges = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const inlineLine = node.inPr && selectedLine !== null ? selectedLine : undefined;
  const isInline = inlineLine !== undefined;

  const submitComment = async () => {
    if (!body.trim()) return;
    try {
      await reviewApi.addComment({
        path: node.path,
        line: inlineLine,
        side: isInline ? 'RIGHT' : undefined,
        body,
      });
      setBody('');
      setStatus(null);
      onChange();
    } catch (error) {
      setStatus(`Add comment failed: ${(error as Error).message}`);
    }
  };

  return (
    <section className="flex flex-col gap-3">
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

      {node.summary ? <p className="text-xs text-slate-700">{node.summary}</p> : null}

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Connections ({connectedEdges.length})
        </div>
        <ul className="flex flex-col gap-2">
          {connectedEdges.map((edge) => {
            const isSource = edge.source === node.id;
            const other = isSource ? edge.target : edge.source;
            return (
              <li key={edge.id} className="rounded border border-slate-200 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-700">
                    {isSource ? '→' : '←'} {other}
                  </span>
                  <span className={`rounded border px-1 text-[10px] ${originBadge(edge)}`}>
                    {edge.origin} · {Math.round(edge.confidence * 100)}%
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
            Diff {selectedLine !== null ? `· commenting on line ${selectedLine}` : '· click a line to comment inline'}
          </div>
          <DiffView patch={node.patch} />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={isInline ? `Comment on ${node.path}:${selectedLine}` : `General comment on ${node.path}`}
          className="h-16 rounded border border-slate-300 p-2 text-xs"
        />
        <button
          onClick={submitComment}
          disabled={!body.trim()}
          className="self-start rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          {isInline ? `Add inline comment (line ${selectedLine})` : 'Add general comment'}
        </button>
      </div>
    </section>
  );
}
