import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { aiApi, type ChatMessage } from './chat-api';
import { computeAnchorPosition } from './popup-position';

interface AiChatPopupProps {
  anchorRect: { top: number; bottom: number; left: number };
  scrollContainer: HTMLElement | null;
  contextCode: string;
  contextLabel: string;
  onClose: () => void;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function AiChatPopup({
  anchorRect,
  scrollContainer,
  contextCode,
  contextLabel,
  onClose,
}: AiChatPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ width: 360, height: 200 });
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    origin: 'top left' | 'bottom left';
  } | null>(null);

  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [openScrollTop, setOpenScrollTop] = useState(0);

  useEffect(() => {
    openerRef.current = document.activeElement;
    setOpenScrollTop(scrollContainer?.scrollTop ?? 0);
    requestAnimationFrame(() => setMounted(true));
    return () => {
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, [scrollContainer]);

  useEffect(() => {
    if (mounted && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mounted]);

  useLayoutEffect(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, [turns, pending, error]);

  const computePosition = (scrollDelta: number) => {
    const adjustedAnchor = {
      top: anchorRect.top - scrollDelta,
      bottom: anchorRect.bottom - scrollDelta,
      left: anchorRect.left,
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return computeAnchorPosition(adjustedAnchor, viewport, size);
  };

  useLayoutEffect(() => {
    const scrollDelta = (scrollContainer?.scrollTop ?? 0) - openScrollTop;
    setPosition(computePosition(scrollDelta));
  }, [anchorRect, size, openScrollTop, scrollContainer]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollDelta = (scrollContainer?.scrollTop ?? 0) - openScrollTop;
      setPosition(computePosition(scrollDelta));
    };
    const handleResize = () => {
      const scrollDelta = (scrollContainer?.scrollTop ?? 0) - openScrollTop;
      setPosition(computePosition(scrollDelta));
    };
    scrollContainer?.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);
    return () => {
      scrollContainer?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [scrollContainer, openScrollTop, anchorRect, size]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [turns, pending]);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const resolveModel = async (): Promise<string> => {
    if (modelId) return modelId;
    const { models } = await aiApi.listModels();
    const coder = models.find((m) => m.name.toLowerCase().includes('coder'));
    const id = coder?.id ?? models[0]?.id;
    if (!id) throw new Error('No AI models available');
    setModelId(id);
    return id;
  };

  const sendMessage = async () => {
    if (!input.trim() || pending) return;

    const question = input.trim();
    setInput('');
    setError(null);

    const userContent =
      turns.length === 0
        ? `${contextCode}\n\nAnswer concisely.\nQuestion: ${question}`
        : question;

    const userTurn: Turn = { role: 'user', content: question };
    setTurns((prev) => [...prev, userTurn]);
    setPending(true);

    try {
      const model = await resolveModel();
      const messages: ChatMessage[] = [
        ...(turns.length === 0
          ? []
          : turns.map((t) => ({ role: t.role, content: t.content }))),
        { role: 'user', content: userContent },
      ];
      const { reply } = await aiApi.ask({ model, messages });
      setTurns((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setError('Request failed');
    } finally {
      setPending(false);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const animationStyle = mounted
    ? { opacity: 1, transform: 'scale(1)' }
    : { opacity: 0, transform: prefersReducedMotion ? 'scale(1)' : 'scale(0.96)' };

  const transitionStyle = prefersReducedMotion
    ? { transition: 'opacity 170ms var(--ease-out)' }
    : { transition: 'opacity 170ms var(--ease-out), transform 170ms var(--ease-out)' };

  if (!position) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-40 flex w-[360px] max-h-[min(60vh,420px)] flex-col rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{
        top: position.top,
        left: position.left,
        transformOrigin: position.origin,
        ...animationStyle,
        ...transitionStyle,
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {contextLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Close"
        >
          &#10005;
        </button>
      </div>

      <div
        ref={conversationRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <div
              key={index}
              className="self-end rounded bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800"
            >
              {turn.content}
            </div>
          ) : (
            <div
              key={index}
              className="whitespace-pre-wrap border-l-2 border-purple-300 bg-purple-50/50 px-2 py-1.5 text-sm dark:border-purple-700 dark:bg-purple-950/20"
            >
              {turn.content}
            </div>
          ),
        )}
        {pending && (
          <div className="text-sm text-slate-500 dark:text-slate-400">Thinking...</div>
        )}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-100 p-2 dark:border-slate-800">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this code..."
          rows={1}
          className="min-h-[36px] flex-1 resize-none rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={!input.trim() || pending}
          className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-600"
        >
          Send
        </button>
      </div>
    </div>,
    document.body,
  );
}
