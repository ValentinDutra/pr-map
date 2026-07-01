export function computeAnchorPosition(
  anchor: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  gap = 6
): { top: number; left: number; origin: 'top left' | 'bottom left' } {
  const minLeft = 8;
  const maxLeft = viewport.width - size.width - 8;
  const left = Math.max(minLeft, Math.min(anchor.left, maxLeft));

  const belowFits = anchor.bottom + gap + size.height <= viewport.height - 8;

  if (belowFits) {
    return { top: anchor.bottom + gap, left, origin: 'top left' };
  }

  return { top: anchor.top - size.height - gap, left, origin: 'bottom left' };
}
