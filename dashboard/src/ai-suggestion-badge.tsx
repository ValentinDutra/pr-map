// Shared pill that labels AI-generated content as advisory. Uses the same purple accent
// as LLM-inferred graph edges so AI suggestions read consistently across the dashboard and
// stay visually distinct from the human's own review actions.
export function AiSuggestionBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300 ${className}`}
    >
      AI suggestion
    </span>
  );
}
