import { describe, it, expect } from 'vitest';
import { computeAnchorPosition } from './popup-position';

describe('computeAnchorPosition', () => {
  const size = { width: 200, height: 100 };
  const gap = 6;

  it('places popup below anchor when there is room', () => {
    const anchor = { top: 50, bottom: 70, left: 100 };
    const viewport = { width: 800, height: 600 };

    const pos = computeAnchorPosition(anchor, viewport, size, gap);

    expect(pos.top).toBe(anchor.bottom + gap);
    expect(pos.origin).toBe('top left');
  });

  it('flips popup above anchor when near viewport bottom', () => {
    const anchor = { top: 480, bottom: 500, left: 100 };
    const viewport = { width: 800, height: 600 };

    const pos = computeAnchorPosition(anchor, viewport, size, gap);

    expect(pos.top).toBe(anchor.top - size.height - gap);
    expect(pos.origin).toBe('bottom left');
  });

  it('clamps left so popup stays within viewport when anchor is near right edge', () => {
    const anchor = { top: 50, bottom: 70, left: 700 };
    const viewport = { width: 800, height: 600 };

    const pos = computeAnchorPosition(anchor, viewport, size, gap);

    expect(pos.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(pos.left).toBe(viewport.width - size.width - 8);
  });

  it('clamps left to minimum 8 when anchor is near left edge', () => {
    const anchor = { top: 50, bottom: 70, left: 2 };
    const viewport = { width: 800, height: 600 };

    const pos = computeAnchorPosition(anchor, viewport, size, gap);

    expect(pos.left).toBe(8);
  });

  it('uses default gap of 6', () => {
    const anchor = { top: 50, bottom: 70, left: 100 };
    const viewport = { width: 800, height: 600 };

    const pos = computeAnchorPosition(anchor, viewport, size);

    expect(pos.top).toBe(anchor.bottom + 6);
  });
});
