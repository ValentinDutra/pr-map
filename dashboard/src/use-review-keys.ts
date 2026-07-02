import { useEffect } from 'react';
import { useAiChatOpen, type DetailTab } from './store';

// Pure index math for file navigation, split out so it is unit-testable without the DOM.

export function nextIndex(length: number, current: number): number {
  if (length === 0) return -1;
  if (current < 0) return 0;
  return (current + 1) % length;
}

export function prevIndex(length: number, current: number): number {
  if (length === 0) return -1;
  if (current < 0) return 0;
  return (current - 1 + length) % length;
}

// The next path not in `viewed`, searching forward from current+1 and wrapping. -1 if all viewed.
export function nextUnviewedIndex(paths: string[], current: number, viewed: Set<string>): number {
  for (let step = 1; step <= paths.length; step += 1) {
    const index = (current + step) % paths.length;
    if (!viewed.has(paths[index])) return index;
  }
  return -1;
}

export interface ReviewKeyNode {
  id: string;
  path: string;
}

export interface ReviewKeysDeps {
  nodes: ReviewKeyNode[];
  selectedNodeId: string | null;
  viewedPaths: Set<string>;
  onSelect: (nodeId: string) => void;
  onToggleViewed: (path: string) => void;
  onSetTab: (tab: DetailTab) => void;
  onToggleHelp: () => void;
}

// Keys typed into a form control are the user's text, never shortcuts.
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || !el.tagName) return false;
  return (
    el.isContentEditable === true ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

export function shouldHandleReviewKey(target: EventTarget | null, isAiChatOpen: boolean): boolean {
  if (isAiChatOpen) return false;
  if (isTypingTarget(target)) return false;
  return true;
}

// Window-level keyboard navigation for the review loop. Lives next to the graph because that is
// where selection and the file list already are.
export function useReviewKeys({
  nodes,
  selectedNodeId,
  viewedPaths,
  onSelect,
  onToggleViewed,
  onSetTab,
  onToggleHelp,
}: ReviewKeysDeps): void {
  const isAiChatOpen = useAiChatOpen((s) => s.open);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!shouldHandleReviewKey(event.target, isAiChatOpen)) return;

      const currentIndex = selectedNodeId
        ? nodes.findIndex((node) => node.id === selectedNodeId)
        : -1;
      const go = (index: number) => {
        if (index < 0) return;
        event.preventDefault();
        onSelect(nodes[index].id);
      };

      switch (event.key) {
        case 'j':
          go(nextIndex(nodes.length, currentIndex));
          break;
        case 'k':
          go(prevIndex(nodes.length, currentIndex));
          break;
        case 'n':
          go(nextUnviewedIndex(nodes.map((node) => node.path), currentIndex, viewedPaths));
          break;
        case 'v':
          if (currentIndex >= 0) {
            event.preventDefault();
            onToggleViewed(nodes[currentIndex].path);
          }
          break;
        case 'd':
          event.preventDefault();
          onSetTab('diff');
          break;
        case 'i':
          event.preventDefault();
          onSetTab('insights');
          break;
        case '?':
          event.preventDefault();
          onToggleHelp();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nodes, selectedNodeId, viewedPaths, onSelect, onToggleViewed, onSetTab, onToggleHelp, isAiChatOpen]);
}
