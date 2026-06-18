// Renders an ISO timestamp from GitHub as a short, locale-aware date for comment headers.
// Falls back to the raw value if it cannot be parsed so nothing renders as "Invalid Date".
export function formatCommentTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
