import type { DetailTab } from './store';
import type { GraphEdge, PrGraph, ReviewState, ReviewThread } from './types';
import { useSelection, usePanelTab } from './store';
import { useViewedState } from './viewed-state';
import { DiffView } from './diff-view';
import { AiSuggestionBadge } from './ai-suggestion-badge';

function originBadge(edge: GraphEdge): string {
  return edge.origin === 'llm'
    ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
    : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function originLabel(edge: GraphEdge): string {
  return edge.origin === 'llm' ? 'AI' : 'import';
}

function InsightList({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className={`text-xs font-semibold ${color}`}>{label}</div>
      <ul className="ml-4 list-disc text-sm text-slate-600 dark:text-slate-300">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'diff', label: 'Diff' },
  { id: 'insights', label: 'Insights' },
];

interface DetailPanelProps {
  graph: PrGraph;
  pending: ReviewState | null;
  threads: ReviewThread[] | null;
  onChange: () => void;
  onThreadsChange: () => void;
  setStatus: (status: string | null) => void;
}

export function DetailPanel({
  graph,
  pending,
  threads,
  onChange,
  onThreadsChange,
  setStatus,
}: DetailPanelProps) {
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const activeTab = usePanelTab((state) => state.activeTab);
  const setTab = usePanelTab((state) => state.setTab);
  const viewedPaths = useViewedState((state) => state.viewedPaths);
  const toggleViewed = useViewedState((state) => state.toggle);

  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500">
        Select a file node to see its connections, diff, and to comment.
      </p>
    );
  }

  const connectedEdges = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const changedFiles = graph.nodes.filter((candidate) => candidate.inPr);
  const viewedChangedCount = changedFiles.filter((candidate) =>
    viewedPaths.has(candidate.path),
  ).length;
  const isNodeViewed = viewedPaths.has(node.path);
  const fileComments = (pending?.comments ?? []).filter((comment) => comment.path === node.path);
  const fileThreads = (threads ?? []).filter((thread) => thread.path === node.path);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="break-all font-mono text-base font-semibold text-slate-800 dark:text-slate-100">
            {node.path}
          </div>
          {node.inPr ? (
            <label
              title="Mark this file as reviewed"
              className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"
            >
              <input
                type="checkbox"
                checked={isNodeViewed}
                onChange={() => toggleViewed(node.path)}
                className="h-3.5 w-3.5"
              />
              Viewed
            </label>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{node.language}</span>
          <span>·</span>
          <span>{node.inPr ? node.status ?? 'changed' : 'neighbor (not in this PR)'}</span>
          {node.inPr && node.additions !== undefined ? (
            <>
              <span className="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700 dark:bg-green-950/50 dark:text-green-300">
                +{node.additions}
              </span>
              <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                -{node.deletions ?? 0}
              </span>
            </>
          ) : null}
        </div>
        {changedFiles.length > 0 ? (
          <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            viewed {viewedChangedCount} of {changedFiles.length}
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-b border-slate-200 text-sm dark:border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 ${
              activeTab === tab.id
                ? 'border-slate-800 font-semibold text-slate-800 dark:border-slate-100 dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'insights' ? (
        <>
          {node.summary ? (
            <div className="rounded border-l-2 border-purple-300 bg-purple-50/50 p-2 dark:border-purple-700 dark:bg-purple-950/20">
              <AiSuggestionBadge className="mb-1" />
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{node.summary}</p>
            </div>
          ) : null}

          {node.insights ? (
            <div className="rounded border-l-2 border-purple-300 bg-purple-50/50 p-2 dark:border-purple-700 dark:bg-purple-950/20">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  AI review suggestions
                </span>
                <AiSuggestionBadge />
              </div>
              <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                Suggestions to guide your review — not verified. You decide what's real.
              </p>
              {node.insights.impact ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-semibold">Impact:</span> {node.insights.impact}
                </p>
              ) : null}
              <InsightList label="Risks" items={node.insights.risks} color="text-red-700 dark:text-red-400" />
              <InsightList
                label="Suspected bugs"
                items={node.insights.suspectedBugs}
                color="text-amber-700 dark:text-amber-400"
              />
              <InsightList
                label="Tests to check"
                items={node.insights.testsToCheck}
                color="text-slate-700 dark:text-slate-300"
              />
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Connections ({connectedEdges.length})
            </div>
            <ul className="flex flex-col gap-2">
              {connectedEdges.map((edge) => {
                const isSource = edge.source === node.id;
                const other = isSource ? edge.target : edge.source;
                return (
                  <li key={edge.id} className="rounded border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="break-all font-mono text-slate-700 dark:text-slate-200">
                        {isSource ? '→' : '←'} {other}
                      </span>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${originBadge(edge)}`}>
                        {originLabel(edge)} · {Math.round(edge.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {edge.kind} · {edge.direction}
                      {edge.affectedSymbol ? ` · ${edge.affectedSymbol}` : ''}
                    </div>
                    {edge.why ? (
                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {edge.origin === 'llm' ? (
                          <span className="font-medium text-purple-700 dark:text-purple-300">AI reasoning: </span>
                        ) : null}
                        {edge.why}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}

      {activeTab === 'diff' ? (
        node.inPr && node.patch ? (
          isNodeViewed ? (
            <button
              type="button"
              onClick={() => toggleViewed(node.path)}
              className="flex items-center gap-2 self-start rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
            >
              <span className="font-medium text-green-700 dark:text-green-400">Viewed</span>
              <span>— diff collapsed, expand</span>
            </button>
          ) : (
            <DiffView
              key={node.path}
              patch={node.patch}
              path={node.path}
              comments={fileComments}
              threads={fileThreads}
              onChange={onChange}
              onThreadsChange={onThreadsChange}
              setStatus={setStatus}
            />
          )
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No diff — this file is a neighbor, not changed in this PR.
          </p>
        )
      ) : null}
    </section>
  );
}
