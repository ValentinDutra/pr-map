import { useState } from 'react';
import type { DetailTab } from './store';
import type { GraphEdge, PrGraph, ReviewState } from './types';
import { useSelection, usePanelTab } from './store';
import { DiffView } from './diff-view';
import { reviewApi } from './review-api';

function originBadge(edge: GraphEdge): string {
  return edge.origin === 'llm'
    ? 'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
    : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function InsightList({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1">
      <div className={`text-[11px] font-medium ${color}`}>{label}</div>
      <ul className="ml-3 list-disc text-[11px] text-slate-600 dark:text-slate-300">
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
  { id: 'conversation', label: 'Conversation' },
];

interface DetailPanelProps {
  graph: PrGraph;
  pending: ReviewState | null;
  onChange: () => void;
  setStatus: (status: string | null) => void;
}

export function DetailPanel({ graph, pending, onChange, setStatus }: DetailPanelProps) {
  const selectedNodeId = useSelection((state) => state.selectedNodeId);
  const activeTab = usePanelTab((state) => state.activeTab);
  const setTab = usePanelTab((state) => state.setTab);
  const [conversationBody, setConversationBody] = useState('');
  const [postedComments, setPostedComments] = useState<string[]>([]);

  const postConversationComment = async () => {
    if (!conversationBody.trim()) return;
    try {
      await reviewApi.addConversationComment(conversationBody);
      setPostedComments((previous) => [...previous, conversationBody]);
      setConversationBody('');
      setStatus('Posted conversation comment');
    } catch (error) {
      setStatus(`Conversation comment failed: ${(error as Error).message}`);
    }
  };

  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Select a file node to see its connections, diff, and to comment.
      </p>
    );
  }

  const connectedEdges = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const fileComments = (pending?.comments ?? []).filter((comment) => comment.path === node.path);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{node.path}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {node.language}
          {node.inPr ? ` · ${node.status ?? 'changed'}` : ' · neighbor (not in this PR)'}
          {node.inPr && node.additions !== undefined
            ? ` · +${node.additions} / -${node.deletions ?? 0}`
            : ''}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 text-xs dark:border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`-mb-px border-b-2 px-2 py-1 ${
              activeTab === tab.id
                ? 'border-slate-800 font-medium text-slate-800 dark:border-slate-100 dark:text-slate-100'
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
            <p className="text-xs text-slate-700 dark:text-slate-300">{node.summary}</p>
          ) : null}

          {node.insights ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Review insights
              </div>
              {node.insights.impact ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-medium">Impact:</span> {node.insights.impact}
                </p>
              ) : null}
              <InsightList label="Risks" items={node.insights.risks} color="text-red-700" />
              <InsightList
                label="Suspected bugs"
                items={node.insights.suspectedBugs}
                color="text-amber-700"
              />
              <InsightList
                label="Tests to check"
                items={node.insights.testsToCheck}
                color="text-slate-700"
              />
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Connections ({connectedEdges.length})
            </div>
            <ul className="flex flex-col gap-2">
              {connectedEdges.map((edge) => {
                const isSource = edge.source === node.id;
                const other = isSource ? edge.target : edge.source;
                return (
                  <li key={edge.id} className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-slate-700 dark:text-slate-200">
                        {isSource ? '→' : '←'} {other}
                      </span>
                      <span className={`rounded border px-1 text-[10px] ${originBadge(edge)}`}>
                        {edge.origin} · {Math.round(edge.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {edge.kind} · {edge.direction}
                      {edge.affectedSymbol ? ` · ${edge.affectedSymbol}` : ''}
                    </div>
                    {edge.why ? (
                      <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{edge.why}</div>
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
          <DiffView
            patch={node.patch}
            path={node.path}
            comments={fileComments}
            onChange={onChange}
            setStatus={setStatus}
          />
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            No diff — this file is a neighbor, not changed in this PR.
          </p>
        )
      ) : null}

      {activeTab === 'conversation' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            A standalone PR comment, posted to the Conversation tab on GitHub immediately.
          </p>
          {postedComments.map((text, index) => (
            <div
              key={index}
              className="rounded border border-slate-200 p-2 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              {text}
            </div>
          ))}
          <textarea
            value={conversationBody}
            onChange={(event) => setConversationBody(event.target.value)}
            placeholder="Comment on the whole PR…"
            className="h-20 rounded border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={postConversationComment}
            disabled={!conversationBody.trim()}
            className="self-start rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-slate-700"
          >
            Post comment
          </button>
        </div>
      ) : null}
    </section>
  );
}
